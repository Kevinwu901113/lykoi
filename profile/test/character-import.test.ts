import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { readCard, convertCard, importCharacter } from '../character-import.ts'
import { createInstance, restoreInstance } from '../instance-state.ts'
import { loadPersona, buildPersonaKernel } from 'lykoi-decide'

const data = { name: '旅人', description: '{{char}} 喜欢地图。', personality: '好奇', scenario: '{{user}} 在车站等车', first_mes: '你好\n你也在等车？', mes_example: '{{user}}：是的\n{{char}}：一起等吧。' }
test('JSON card becomes a runnable immutable instance; original unknown metadata is retained byte for byte', () => {
  const root = mkdtempSync(join(tmpdir(), 'card-import-'))
  try {
    const source = join(root, 'card.json'), bytes = JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { ...data, extensions: { custom: 123 }, character_book: { entries: [] }, system_prompt: 'source-only instructions' } })
    writeFileSync(source, bytes)
    const imported = importCharacter(source, join(root, 'package'), 'Owner')
    assert.equal(readFileSync(join(root, 'package/source.card'), 'utf8'), bytes)
    assert.equal(imported.warnings.length, 2)
    const instance = createInstance({ registry: join(root, 'instances'), id: 'traveller', definition: imported.definition, ownerName: 'Owner' })
    const prompt = buildPersonaKernel(loadPersona(restoreInstance(join(root, 'instances'), instance.id).personaPath))
    assert.ok(prompt.includes('旅人 喜欢地图。')); assert.ok(prompt.includes('Owner 在车站等车'))
    assert.ok(prompt.includes('你好\n你也在等车？')); assert.ok(!prompt.includes('source-only'))
    assert.throws(() => importCharacter(source, join(root, 'package'), 'Owner'), /EEXIST/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('PNG chara metadata uses chunk bounds and CRC; unsupported versions fail explicitly', () => {
  const chunk = (type: string, data: Buffer) => { const payload = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(payload)); return Buffer.concat([length, payload, crc]) }
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('tEXt', Buffer.from('chara\0' + Buffer.from(JSON.stringify(data)).toString('base64'))), chunk('IEND', Buffer.alloc(0))])
  assert.deepEqual(readCard(png), data)
  const v3 = { spec: 'chara_card_v3', spec_version: '3.0', data: { ...data, nickname: '小旅人' } }
  const both = Buffer.concat([png.subarray(0, png.length - 12), chunk('tEXt', Buffer.from('ccv3\0' + Buffer.from(JSON.stringify(v3)).toString('base64'))), chunk('IEND', Buffer.alloc(0))])
  assert.deepEqual(readCard(both), v3)
  assert.ok(convertCard(readCard(both), 'Owner').toml.includes('小旅人 喜欢地图。'))
  const broken = Buffer.from(png); broken[20] ^= 1
  assert.throws(() => readCard(broken), /checksum/)
  assert.throws(() => readCard(png.subarray(0, 15)), /truncated/)
  assert.throws(() => convertCard({ spec: 'unknown', data }, 'Owner'), /supported formats/)
})
