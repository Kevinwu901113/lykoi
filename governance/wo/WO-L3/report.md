# WO-L3 报告 · 跨时间相关性检索

分支 `wo/l3`，基于 `cdd21dd0`。**未 push。**

## 1. git log / diff --stat

```
f4a74665 [WO-L3] 检索专项测试 + manifest 重签 (97 -> 98 条)
8477e641 [WO-L3] 跨时间相关性检索: relevance.py (四轴召回 + 中文 bigram 匹配)
cdd21dd0 [WO-L1][review-fix] outbox test: ...   ← 基线

$ git diff --stat cdd21dd0..HEAD
 guardian/manifest.sha256    |   1 +
 src/lykoi/mind/relevance.py | 390 +++++++++++++++++++++++++++++++++++
 tests/test_l3_relevance.py  | 491 ++++++++++++++++++++++++++++++++++++++++++++
 3 files changed, 882 insertions(+)
```

**硬数字**：新增文件 2（`src/lykoi/mind/relevance.py` 390 行、`tests/test_l3_relevance.py` 491 行），修改文件 1（`guardian/manifest.sha256` +1 行）。合计 +882 行，删除 0 行。**无迁移、无新表、无新索引、无新依赖、无状态文件。**

## 2. 检索模块完整代码

`src/lykoi/mind/relevance.py`（390 行，全文）：

```python
"""mind/relevance.py — 跨时间相关性检索 (学习层 v2 设计 §3.6).

设计 §3.6 把这台机器叫做"本设计唯一的新机器"。它的唯一消费方是层 2 专注思考
的第 2 步(§3.4):给定一个关切,从她**全部**经验里把相关的捞出来 ——
不限于未消化项,已消化的、几个月前的、档案层里的都要能召回。§3.9 说档案层
"不遗忘,是她回想细节的能力基础";本模块就是把那句话兑现成可调用的能力,
档案从此不是垃圾桶,而是可检索的记忆。

**四个召回轴**(§3.6 最小实现):

- 关键词轴:从关切的 title/description 提取匹配项,对 ``experiences.content`` 匹配;
- 实体轴:``subject_user_id`` 走 P2-01 的 ``memory_scopes``(接法同 ``archive_search``);
- 时间轴:``since`` / ``until`` 对 ``experiences.ts`` 过滤;
- 来源轴:结果里带 ``source``,**不做硬过滤** —— 挑不挑食是层 2 的判断,
  检索机器不替它决定。

**零 schema**:不新增表、不新增迁移、不新增索引。原料池约千条量级,
全扫 + 内存打分足以召回(§3.6"为什么够用"),建索引在这个量级上是提前优化。

**只读**:本模块零写入。唯一的写路径来自 ``store._connect()`` 里的
``apply_migrations`` / ``_init_rows``(那是所有读接口共有的幂等开库动作,
库已就绪时不产生任何变更),本模块自身不执行任何 INSERT/UPDATE/DELETE。

**可替换性**(§3.6 升级路径):对外的接口就是 :func:`retrieve_for_concern` 的
签名与返回结构 —— 入参 ``(concern, limit, since, until)``、返回按相关性降序、
每条带 ``relevance_score`` 与 ``match_reasons``。"怎么算相关"整个收在本模块的
私有函数里(``_extract_query``/``_score_content``)。将来换向量检索,只需把这两个
私有函数替换成 embedding + 近邻查询、``match_reasons`` 改成"最近邻距离/命中片段",
调用方(层 2)一行都不用改。**本版不做向量检索**(§3.6),也不做类继承体系 ——
一个函数一个模块就够,多态在这里是负债。
"""
from __future__ import annotations

import unicodedata

from lykoi.mind import store as _store

# --- 打分权重(纯启发式,可调;改动请同步更新测试里的排序断言) --------------
_TITLE_WEIGHT = 1.5      # 标题是关切的本体,描述是注脚
_DESC_WEIGHT = 1.0
_ASCII_TERM_SCORE = 2.0  # 一个完整英文词命中 == 一段两字中文短语命中
_ENTITY_SCORE = 1.0      # 实体轴命中的加分(硬过滤下是常数,只为让分数自洽)

# 最短的英文/数字词。单字符 token("a"/"3")在任何语料里都是噪声。
_ASCII_MIN_LEN = 2

# 极小停用词表(纯 stdlib,不引入任何分词/词表依赖)。
# 英文:只挡最高频的功能词,不做完整停用词工程 —— 挡不住的靠打分稀释。
_ASCII_STOPWORDS = frozenset({
    "the", "and", "for", "with", "that", "this", "you", "are", "was", "were",
    "have", "has", "had", "not", "but", "from", "什么", "怎么",
})
# 中文:功能字。一个 bigram 若**两个字都**是功能字(如"的了"/"是在"),
# 它承载的语义近似于零,丢掉。只有一个功能字的 bigram 保留("的事"仍可能有用,
# 且丢掉会伤到"我的项目"这类真实短语的链条)。
_CJK_FUNCTION_CHARS = frozenset("的了是在我他她它和就都而及与也很有个上下不这那你们着过被把从对")


def retrieve_for_concern(
    concern: dict,
    *,
    limit: int = 20,
    since: str | None = None,
    until: str | None = None,
) -> list[dict]:
    """给一个关切,跨时间召回相关经验。按相关性降序返回。

    ``concern`` 至少认三个键,**不要求是 ``concerns`` 表的行** —— 层 2 也会拿
    临时构造的问题来查(§3.4 第 2 步),所以这里只认 dict 的形状,不认来源:

    - ``title``:关切标题,关键词轴的主要来源(权重 ``_TITLE_WEIGHT``);
    - ``description``:补充描述,可空(权重 ``_DESC_WEIGHT``);
    - ``subject_user_id``:实体轴,可空。给了就是**硬过滤**(接法与语义同
      ``store.archive_search``:某人的关切不该召回另一个人的原料)。

    ``since`` / ``until`` 是 ``experiences.ts`` 的闭区间过滤(时间轴)。
    ``limit`` 是返回条数上限,必须 >= 0。

    检索域 = **全部 experiences**:working 与 archive、``integrated`` 0 与 1
    都在内。这是本函数存在的理由 —— 层 1 的 ``working_set_pending`` 只看未消化的
    原料,层 2 要的是"她所有的经验"。

    每条结果是 ``experiences`` 的整行(含 ``source`` —— 来源轴不硬过滤,信息交给
    调用方),外加三个键:

    - ``relevance_score``:float,打分口径见 :func:`_score_content`;
    - ``match_reasons``:list[str],命中了哪些关键词片段 / 哪个实体轴。
      层 2 的结论要能回溯"为什么调了这条原料"(§3.7 血缘的前置),所以命中理由
      必须是真实片段,不是"matched"这种占位符;
    - ``experience_class``:``'working'`` / ``'archive'`` / ``None``(影子表缺行时)。

    **排序是确定性的**:``(relevance_score DESC, id DESC)``。同分按 id 倒序 ——
    id 单调递增,所以同分时新的在前,且两次调用必然同序。

    **无可提取词项时的行为**:标题/描述里榨不出任何词项(空串、纯标点、纯停用词)
    时,若给了 ``subject_user_id`` 就退化为"这个人的全部经验"(实体轴本身就是
    一条正当的召回轴),否则返回 ``[]``。**不会**退化成"返回全库最近 N 条" ——
    那会把"我没读懂你的问题"伪装成"这些都相关",也会让一个只含 ``%`` 的标题
    看起来像通配了整个档案。
    """
    if limit < 0:
        raise ValueError("limit must be >= 0")

    query = _extract_query(concern)
    subject_user_id = concern.get("subject_user_id")
    if not query and subject_user_id is None:
        return []

    rows = _candidate_rows(
        terms=_prefilter_terms(query),
        subject_user_id=subject_user_id,
        since=since,
        until=until,
    )

    scored: list[dict] = []
    for row in rows:
        item = dict(row)
        score, reasons = _score_content(item.get("content") or "", query)
        if query and not reasons:
            continue  # SQL 的 LIKE 预筛比打分宽(见 _candidate_rows),这里定稿
        if subject_user_id is not None:
            score += _ENTITY_SCORE
            reasons.append(f"entity:subject_user_id={subject_user_id}")
        item["relevance_score"] = round(score, 6)
        item["match_reasons"] = reasons
        scored.append(item)

    scored.sort(key=lambda r: (-r["relevance_score"], -r["id"]))
    return scored[:limit]


# === 关键词提取(本单的设计重心)==============================================
#
# 她的经验内容几乎全是中文,**没有空格分词可用,也不许新增分词依赖**(不装
# jieba 等任何包)。所以这里是一套纯 stdlib 的方案:
#
# 【提取规则】
# 1. NFKC 归一 + casefold:全角"ＡＢＣ"与半角"abc"、大小写,一律折成同一形态。
#    (中文内容里全角英文/数字很常见,不归一会漏。)
# 2. 按"字符类"切段:CJK 字符归一段、ASCII 字母数字归一段,其余(空白、标点、
#    emoji、``%``、``_``)一律当分隔符。**通配符字符因此从不进入词项**,
#    这是"关切标题里带 % / _ 不会越权通配"的第一道结构性保证(第二道是 LIKE
#    ESCAPE,见 _candidate_rows)。
# 3. ASCII 段:整段就是一个词项,长度 >= 2 且不在停用词表内才留。
# 4. CJK 段:切成**相邻二字组(bigram)**。长度 1 的段丢弃。两个字都是功能字的
#    bigram 丢弃。
#
# 【为什么这对中文成立】
# 现代汉语的内容词以双字词为绝对主体,bigram 因此天然对齐"词"这个单位,不需要
# 任何词表。"睡眠质量" → {睡眠, 眠质, 质量}:其中"睡眠""质量"是真词,"眠质"是
# 跨词边界的噪声 bigram —— 但噪声 bigram 极少在真实语料里出现,所以它几乎只
# 在**整个短语原样出现**时才命中。这就是打分里"连续链"加分的依据:命中的
# bigram 越连得上,说明原文里出现的片段越长、越是原短语本身。
# 反过来,单字切分会把"质"匹到"质疑/物质/人质"上,是典型的假召回;bigram 把
# 判别力抬到了词一级 —— "睡眠"不会命中"睡衣","质量"不会命中"质疑"。
#
# 【已知盲区(诚实清单)】
# - **单字关切**:标题只有一个汉字(如"钱""家")→ 提不出 bigram → 该段无贡献。
#   单字的假召回率高到不值得召回,这是有意的取舍,不是遗漏。
# - **跨词边界假命中**:查询 bigram 可能落在原文两个词的接缝上。例:查询
#   "外国人"含 bigram"国人",原文"中国人民"里也有"国人"。它只得 1 分(孤立
#   bigram,无链),会被真短语命中压到后面,但确实进了候选。
# - **同义/近义为零**:"睡不着"召不回"失眠","Kevin"召不回"凯文"。这是
#   §3.6 明说要留给向量检索的部分,本版不做。
# - **简繁不通**:"睡眠"与"睡眠"以外的繁体写法互不召回(NFKC 不做简繁转换)。
# - **语序敏感**:"质量睡眠"与"睡眠质量"共享 bigram"质量"/"睡眠",链断开,
#   分数低于原序命中 —— 这是想要的行为(语序在中文里携带语义),但对倒装表达
#   会低估。
# - **英文靠整词**:英文只做整词(子串)匹配,不做词干还原 —— "meeting" 召不回
#   "meet"。


class _QueryRun:
    """一段查询词的最小单位:一个 CJK 段或一个 ASCII 词,连同它的字段权重。

    保留 ``text`` 原样(而不是只留 bigram 列表)是为了 ``match_reasons`` ——
    命中链要能还原成原文片段,层 2 才能看懂"为什么调了这条"。
    """

    __slots__ = ("kind", "text", "grams", "weight", "field")

    def __init__(self, kind: str, text: str, grams: tuple[str, ...], weight: float, field: str):
        self.kind = kind          # 'cjk' | 'ascii'
        self.text = text          # 用于 SQL LIKE 预筛的整段/整词
        self.grams = grams        # cjk: bigram 序列;ascii: 空
        self.weight = weight
        self.field = field        # 'title' | 'description'


def _extract_query(concern: dict) -> list[_QueryRun]:
    """把关切的 title/description 榨成词项。规则见上方长注释。"""
    runs: list[_QueryRun] = []
    seen: set[tuple[str, str]] = set()  # (kind, text) 去重:标题里重复的词只算一次
    for field, weight in (("title", _TITLE_WEIGHT), ("description", _DESC_WEIGHT)):
        text = concern.get(field) or ""
        if not isinstance(text, str):
            continue
        for kind, segment in _segments(text):
            key = (kind, segment)
            if key in seen:
                continue
            if kind == "ascii":
                if len(segment) < _ASCII_MIN_LEN or segment in _ASCII_STOPWORDS:
                    continue
                seen.add(key)
                runs.append(_QueryRun(kind, segment, (), weight, field))
            else:
                grams = _bigrams(segment)
                if not grams:
                    continue
                seen.add(key)
                runs.append(_QueryRun(kind, segment, grams, weight, field))
    return runs


def _prefilter_terms(query: list[_QueryRun]) -> list[str]:
    """SQL 预筛用的词项:每个 bigram + 每个 ASCII 词,去重后保序。

    预筛口径必须与 :func:`_score_content` **一致**(命中任一 bigram 即入候选),
    否则 "睡眠质量" 会漏掉只写了 "质量" 的那条原料 —— 预筛比打分窄是丢召回,
    比打分宽只是多算几行(千条量级,无所谓)。
    """
    out: list[str] = []
    seen: set[str] = set()
    for run in query:
        for term in (run.grams or (run.text,)):
            if term not in seen:
                seen.add(term)
                out.append(term)
    return out


def _segments(text: str) -> list[tuple[str, str]]:
    """NFKC + casefold,再按字符类切段。返回 ``[(kind, segment), ...]``。

    非 CJK 非 ASCII 字母数字的一切(标点、空白、emoji、``%``、``_``)都是分隔符,
    所以词项里永远不含 LIKE 通配符。
    """
    normalized = unicodedata.normalize("NFKC", text).casefold()
    out: list[tuple[str, str]] = []
    buf: list[str] = []
    current: str | None = None
    for char in normalized:
        kind = _char_kind(char)
        if kind != current:
            if current is not None and buf:
                out.append((current, "".join(buf)))
            buf, current = [], kind
        if kind is not None:
            buf.append(char)
    if current is not None and buf:
        out.append((current, "".join(buf)))
    return out


def _char_kind(char: str) -> str | None:
    """``'cjk'`` / ``'ascii'`` / ``None``(分隔符)。

    CJK 判定用 Unicode 区段而不是 ``unicodedata`` 的类别名 —— 汉字与日文假名
    同属 ``Lo``,只有区段能把"要 bigram 的表意文字"和别的东西分开。
    """
    code = ord(char)
    if (
        0x4E00 <= code <= 0x9FFF        # CJK 统一表意文字
        or 0x3400 <= code <= 0x4DBF     # 扩展 A
        or 0xF900 <= code <= 0xFAFF     # 兼容表意文字
        or 0x3040 <= code <= 0x30FF     # 日文假名(混排里偶有,同样按表意切 bigram)
    ):
        return "cjk"
    if char.isascii() and char.isalnum():
        return "ascii"
    return None


def _bigrams(segment: str) -> tuple[str, ...]:
    """相邻二字组;两个字都是功能字的丢弃。长度 1 的段返回空(见盲区清单)。"""
    return tuple(
        gram
        for gram in (segment[i:i + 2] for i in range(len(segment) - 1))
        if not (gram[0] in _CJK_FUNCTION_CHARS and gram[1] in _CJK_FUNCTION_CHARS)
    )


# === 打分 ====================================================================

def _score_content(content: str, query: list[_QueryRun]) -> tuple[float, list[str]]:
    """给一条经验内容打分,并给出可回溯的命中理由。

    口径:
    - ASCII 词命中(子串,大小写不敏感)→ ``_ASCII_TERM_SCORE``;
    - CJK 段:命中的 bigram 按**相邻链**聚合,长度 c 的链得 ``2c - 1`` 分
      (孤立 bigram 1 分,两连 3 分,三连 5 分)。超线性是有意的:链越长,
      说明原文里出现的是原短语本身而非跨词边界的巧合(见上方"为什么成立")。
    - 每段的得分再乘字段权重(标题 1.5 / 描述 1.0)。

    ``match_reasons`` 里的关键词片段是**从命中链还原的原文片段**(链 i..j 还原为
    ``segment[i:j+2]``),不是词项 id,不是"matched" —— 层 2 拿它写血缘。
    """
    haystack = unicodedata.normalize("NFKC", content).casefold()
    total = 0.0
    reasons: list[str] = []
    for run in query:
        if run.kind == "ascii":
            if run.text in haystack:
                total += _ASCII_TERM_SCORE * run.weight
                reasons.append(f"keyword:{run.text}@{run.field}")
            continue
        hits = [gram in haystack for gram in run.grams]
        index = 0
        while index < len(hits):
            if not hits[index]:
                index += 1
                continue
            end = index
            while end + 1 < len(hits) and hits[end + 1]:
                end += 1
            chain = end - index + 1
            total += (2 * chain - 1) * run.weight
            reasons.append(f"keyword:{run.text[index:end + 2]}@{run.field}")
            index = end + 1
    return total, reasons


# === 候选行(唯一的 SQL)======================================================

def _candidate_rows(
    *,
    terms: list[str],
    subject_user_id: str | None,
    since: str | None,
    until: str | None,
) -> list:
    """硬过滤(实体/时间)+ 关键词 OR 预筛,拉回候选行。**只读,一条 SELECT。**

    ``terms`` 由 :func:`_prefilter_terms` 展开成"每个 bigram + 每个 ASCII 词",
    与打分口径一致;命中与否的定稿仍在 :func:`_score_content`(SQL 只负责把
    全表缩到候选集,不负责判相关)。已知窄口:SQL 的 LIKE 只对 ASCII 大小写
    不敏感、且比对的是**未归一**的 content,所以内容里写成全角的英文
    (``ＫＥＶＩＮ``)会在这一步漏掉 —— 中文内容不受影响(中文无大小写、
    NFKC 不改常用汉字),这是接受的取舍,不是 bug。

    ``%`` / ``_`` / ``\\`` 按 ``archive_search`` 的做法字面转义 —— 词项本身已经
    不含通配符(切段时被当分隔符丢了),这里是第二道保险:任何将来放宽切段规则
    的改动,都不会因此让用户输入的 ``%`` 通配整个档案。

    ``experience_class`` 用 LEFT JOIN:影子表缺行(极早期 fixture)不该让一条
    真实经验从检索域里消失 —— 检索域是"全部 experiences",不是"已分类的"。
    ``memory_scopes`` 的主键是 ``(table_name, row_id)``,所以实体轴 JOIN 至多
    配出一行,不会放大结果。
    """
    clauses: list[str] = []
    params: list = []

    join = ""
    if subject_user_id is not None:
        join = (
            " JOIN memory_scopes AS ms "
            "ON ms.table_name = 'experiences' AND ms.row_id = e.id"
        )
        clauses.append("ms.subject_user_id = ?")
        params.append(subject_user_id)
    if since is not None:
        clauses.append("e.ts >= ?")
        params.append(since)
    if until is not None:
        clauses.append("e.ts <= ?")
        params.append(until)
    if terms:
        likes = []
        for term in terms:
            escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            likes.append("e.content LIKE ? ESCAPE '\\'")
            params.append(f"%{escaped}%")
        clauses.append("(" + " OR ".join(likes) + ")")

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    conn = _store._connect()
    try:
        rows = conn.execute(
            f"""SELECT e.*, ec.class AS experience_class
                FROM experiences AS e
                LEFT JOIN experience_class AS ec ON ec.experience_id = e.id{join}
                {where}
                ORDER BY e.id""",
            params,
        )
        return [dict(row) for row in rows]
    finally:
        conn.close()
```

## 3. 关键词提取规则（文字说明）

**提取（纯 stdlib，零新依赖）**

1. `unicodedata.normalize("NFKC")` + `casefold()`：全角/半角、大小写折成一种形态。
2. 按字符类切段：CJK 表意字符（U+4E00–9FFF、U+3400–4DBF、U+F900–FAFF，另含假名 U+3040–30FF）连成一段；ASCII 字母数字连成一段；**其余一切（空白、标点、emoji、`%`、`_`、`\`）都是分隔符**。
3. ASCII 段：整段即一个词项，长度 ≥2 且不在极小停用词表内。
4. CJK 段：切成相邻 **bigram**；长度 1 的段丢弃；两个字都是功能字的 bigram（`的了`、`是在`…）丢弃。

**为什么对中文成立**：现代汉语内容词以双字为主体，bigram 天然对齐"词"这一单位，无需词表。`睡眠质量 → {睡眠, 眠质, 质量}`，其中 `眠质` 是跨词边界的噪声 gram，只在整短语原样出现时才命中——所以"命中的 bigram 连成多长的链"直接反映"原文出现的片段有多接近原短语"。打分因此按链长超线性给分（链长 c → `2c-1`），再乘字段权重（title 1.5 / description 1.0）；英文整词命中记 2.0。单字切分会把"质"匹到"质疑/物质/人质"，bigram 把判别力抬到词一级。

**已知盲区（诚实清单，代码注释里同样写死）**
- 单字关切（"钱""家"）提不出 bigram → 不召回（有意取舍）。
- 跨词边界假命中：查询"外国人"的 bigram `国人` 会命中"中国人民"；只得 1 分（孤立 gram，无链），被真短语压到后面，但确实进候选。
- 同义/近义为零："睡不着"召不回"失眠"，"Kevin"召不回"凯文"——§3.6 明说留给向量检索。
- 简繁不通（NFKC 不做简繁转换）。
- 语序敏感："质量睡眠"因链断开分数低于"睡眠质量"（对倒装表达会低估）。
- 英文只做整词子串，无词干还原（"meeting" 召不回 "meet"）。
- SQL 预筛口径窄口：LIKE 比对的是未归一的 content，内容里写成**全角英文**（`ＫＥＶＩＮ`）会在预筛这一步漏掉；中文不受影响。

## 4. success_criteria 逐条 → 测试用例名 + 结果

`tests/test_l3_relevance.py` — **25 passed, 0 failed（110.24s）**，全部合成 fixture，未触碰任何真实备份。

| 判据 | 用例 | 结果 |
|---|---|---|
| 1 四轴召回 · 关键词正反 | `test_keyword_axis_recalls_related_and_excludes_unrelated` | PASS |
| 1 · 实体正反（user_001 / user_002 / 不存在的 user_404） | `test_entity_axis_filters_by_subject_user` | PASS |
| 1 · 时间正反（since 挡早的、until 挡晚的） | `test_time_axis_since_until` | PASS |
| 1 · 组合（关键词∧实体∧时间） | `test_combined_axes_intersect` | PASS |
| 1 · 检索域 working+archive 各钉一条 | `test_domain_covers_working_and_archive` | PASS |
| 1 · 检索域 integrated 0 与 1 各钉一条 | `test_domain_covers_integrated_zero_and_one` | PASS |
| 1 · 来源轴带出不硬过滤 | `test_source_axis_is_carried_not_filtered` | PASS |
| 2 中文标题命中中文内容 | `test_chinese_title_hits_chinese_content` | PASS |
| 2 中文近词不误召（睡眠↛睡衣/睡意，质量↛质疑） | `test_chinese_near_words_are_not_falsely_recalled` | PASS |
| 2 单字盲区钉死 | `test_single_char_query_is_a_documented_blind_spot` | PASS |
| 2 英文混排、大小写不敏感 | `test_mixed_english_is_case_insensitive` | PASS |
| 2 全角归一 | `test_fullwidth_and_case_normalisation` | PASS |
| 2 LIKE 通配符 `%`/`_` 在标题里不炸不越权（含结构性断言：送去 LIKE 的词项永不含 `% _ \`） | `test_like_wildcards_in_title_are_literal_and_do_not_over_recall` | PASS |
| 3 相关性降序可解释、`match_reasons` 真实（片段同时存在于查询与内容） | `test_ranking_is_relevance_descending_and_explainable` | PASS |
| 3 实体轴也进 `match_reasons` | `test_match_reasons_report_the_entity_axis_too` | PASS |
| 3 同分确定性（跑两次同序 + 同分按 id 倒序） | `test_ranking_is_deterministic_across_runs` | PASS |
| 3 limit 在排序之后生效 / limit=0 / limit<0 报错 | `test_limit_is_applied_after_ranking` | PASS |
| 4 只读证明（experiences/experience_class/memory_scopes/concerns 四表逐行相等） | `test_retrieve_is_read_only` | PASS |
| 4 结构性只读（源码无写语句） | `test_module_contains_no_write_statements` | PASS |
| 5 行为不变（pending 计数 + working_set_pending 不变） | `test_pending_and_working_set_unchanged_by_retrieval` | PASS |
| 5 `archive_search` 语义未变 | `test_archive_search_still_behaves_as_before` | PASS |
| 6 零 schema（`sqlite_master` 前后一致，版本仍 11 == `migrations.SCHEMA_VERSION`） | `test_no_new_tables_migrations_or_indexes` | PASS |
| 接口契约 | `test_concern_need_not_be_a_concerns_row`、`test_no_extractable_terms_falls_back_to_entity_only`、`test_returned_rows_are_full_experience_rows` | PASS ×3 |

**判据 5 的现有测试回归**（`test_l1_experience_class.py` + `test_mind_integrator_pipeline.py` + `test_mind_integrator_trigger.py`）：**81 passed, 0 failed（246s）**。

## 5. manifest

用 `startup_verify._protected_files()` / `._sha256()` 自身重算（未走 `--write-manifest`）。

```diff
+02d63be165b1c3fba2b4ca87b7b1672e103cae2bf9041b8c146fc2ad538f76e0  src/lykoi/mind/relevance.py
```

- 条目数 **97 → 98**；added = `src/lykoi/mind/relevance.py`；removed = 空；changed = 空。
- 唯一读不到的条目 `/home/lykoi/state/approval_rules.json`（claude 身份 `PermissionError`）**沿用旧行**。

`pytest tests/test_p0_integrity.py`：**20 passed, 4 skipped, 1 failed**。唯一失败即工单预告的既有假失败 `test_committed_manifest_matches_available_protected_sources` → `PermissionError: '/home/lykoi/state/approval_rules.json'`。重签前它失败在另一处（`protected source missing from manifest: src/lykoi/mind/relevance.py`），重签后回落到这条已知的权限假失败，说明 manifest 条目已补齐。

## 6. 两处需要复核方知情的判断

1. **实体轴做成硬过滤**（而非加权提示），语义与 `archive_search` 一致：某人的关切不召回另一个人的原料。若层 2 想要"跨人回想"，应不传 `subject_user_id`。
2. **榨不出词项时不回退成"最近 N 条"**：给了 `subject_user_id` 就退化为"这个人的全部经验"，否则返回 `[]`。这是刻意的——回退成"最近 N 条"会把"没读懂问题"伪装成"这些都相关"，也会让一个只含 `%` 的标题看起来像通配了整个档案。

零 schema 达成，**未发现需要建表/建索引的场景**（千条量级全扫 + 内存打分，单条 SELECT）。未 push，两个提交留在 `wo/l3`。
