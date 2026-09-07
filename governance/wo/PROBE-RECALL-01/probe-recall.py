#!/usr/bin/env python3
"""Synthetic Topic Recall probe. No state access; API calls require --run."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import time
import tomllib
import urllib.request

HERE = Path(__file__).resolve().parent
TOPICS = [('修车', '青榕车坊', '487'), ('买书', '松影书屋', '163'), ('洗窗', '晴窗服务', '286'),
          ('寄件', '竹桥驿站', '59'), ('花盆', '南园花店', '124'), ('修鞋', '小巷鞋铺', '78')]
FILLER = [('今天把桌面收拾了一下。', '收拾完找东西方便一些。'), ('傍晚散步时风很舒服。', '这样的天气适合慢慢走。'),
          ('早餐做了热粥。', '清淡一点也不错。'), ('阳台的叶子又长大了。', '看来最近照顾得挺好。'),
          ('想把窗帘洗一下。', '挑天气晴的时候晾。'), ('今晚早点休息。', '那就把手头事情放一放。')]


def sample(case, depth):
    topic, noun, number = TOPICS[case - 1]
    turns = []
    for turn in range(1, 41):
        user, assistant = FILLER[(turn + case) % len(FILLER)]
        if turn == 41 - depth:
            user, assistant = f'记一下，这次{topic}找的是{noun}，总共{number}元。', '好，这件事我记下了。'
        turns.extend([{'role': 'user', 'content': user}, {'role': 'assistant', 'content': assistant}])
    return turns, f'上次{topic}找的是哪家，总共多少钱？', noun, number


def summary_prompt(owner='所有者', self_name='助手'):
    source = (HERE.parents[2] / 'packages/lykoi-converse/src/prompts.ts').read_text()
    block = source.split('export const SUMMARIZE_SYSTEM_PROMPT', 1)[1].split('\n\n', 1)[0]
    text = ''.join(ast.literal_eval(s) for s in re.findall(r"'(?:\\.|[^'\\])*'", block))
    return re.sub(r'\{(owner|self)\}', lambda m: owner if m[1] == 'owner' else self_name, text)


def classify(text, noun, number):
    numbers = re.findall(r'(?<!\d)\d+(?:\.\d+)?(?!\d)', text)
    named = noun in text
    numbered = number in numbers
    # Candidate labels only: a reviewer checks negation and unrelated numbers.
    return {'hit_candidate': named and numbered, 'half_candidate': named != numbered,
            'wrong_number_candidate': any(n != number for n in numbers)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--persona', type=Path)
    parser.add_argument('--model', default='deepseek-v4-flash')
    args = parser.parse_args()
    os.umask(0o077)
    args.output.mkdir(parents=True, exist_ok=True)
    persona_text = '你是助手。按对话记录回答；记不清就明确说记不清，不编造。'
    owner, self_name = '所有者', '助手'
    if args.persona:
        persona_text = args.persona.read_text()
        data = tomllib.loads(persona_text)
        owner, self_name = data['voice']['address_owner'], data['identity']['name']
    prompt = summary_prompt(owner, self_name)
    config = {'model': args.model, 'summary_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
              'persona_sha256': hashlib.sha256(persona_text.encode()).hexdigest(), 'cases': TOPICS, 'depths': [3, 8, 15, 30], 'repeats': 2}
    path = args.output / 'config.json'
    if path.exists() and json.loads(path.read_text()) != json.loads(json.dumps(config)):
        parser.error('configuration changed; use a new output directory')
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2))
    if not args.run:
        print('dry-run: 144 recall requests + 48 summary requests; no API call'); return
    key = os.environ.get('DEEPSEEK_API_KEY')
    if not key: parser.error('DEEPSEEK_API_KEY missing')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *unused): return None
    opener = urllib.request.build_opener(NoRedirect)
    def call(identifier, messages):
        dest = args.output / (identifier + '.json')
        if dest.exists(): return json.loads(dest.read_text())
        body = {'model': args.model, 'stream': False, 'thinking': {'type': 'enabled'}, 'reasoning_effort': 'low', 'messages': messages}
        started = time.monotonic()
        row = {'id': identifier, 'status': 'failed'}
        try:
            req = urllib.request.Request('https://api.deepseek.com/chat/completions', data=json.dumps(body).encode(),
                                         headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
            with opener.open(req, timeout=240) as response: data = json.load(response)
            row.update(status='ok', content=data['choices'][0]['message'].get('content') or '', usage=data.get('usage'),
                       finish_reason=data['choices'][0].get('finish_reason'))
        except Exception as error: row['error_type'] = type(error).__name__
        row['elapsed_seconds'] = round(time.monotonic() - started, 3)
        tmp = dest.with_suffix('.tmp'); tmp.write_text(json.dumps(row, ensure_ascii=False, indent=2)); tmp.replace(dest)
        print(identifier, row['status'], flush=True)
        return row
    persona = {'role': 'system', 'content': persona_text}
    scores = []
    for case in range(1, 7):
        for depth in (3, 8, 15, 30):
            turns, question, noun, number = sample(case, depth)
            for repeat in (1, 2):
                prefix = f'{case}-{depth}-{repeat}'
                summary = call('summary-' + prefix, [{'role': 'system', 'content': prompt},
                               {'role': 'user', 'content': '\n'.join(m['role'] + ': ' + m['content'] for m in turns[:-16])}])
                for mode in ('W8', 'W8S', 'W8M'):
                    if mode == 'W8S' and summary['status'] != 'ok': continue
                    extra = []
                    if mode == 'W8S': extra = [{'role': 'system', 'content': '早前摘要：\n' + summary['content']}]
                    if mode == 'W8M': extra = [{'role': 'system', 'content': f'检索命中（合成、理想命中条件）：{noun}，{number}元。'}]
                    row = call(mode + '-' + prefix, [persona] + extra + turns[-16:] + [{'role': 'user', 'content': question}])
                    scores.append({'case': case, 'depth': depth, 'repeat': repeat, 'mode': mode, 'status': row['status'],
                                   **(classify(row['content'], noun, number) if row['status'] == 'ok' else {})})
    (args.output / 'candidates.json').write_text(json.dumps(scores, ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
