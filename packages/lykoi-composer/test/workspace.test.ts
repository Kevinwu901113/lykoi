import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { builtins, ensureWorkspace } from '../src/builtins.ts'

test('workspace tools reject path escape, symlink files and parents, and overwriting existing results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'composer-paths-'))
  try {
    const workspace = await ensureWorkspace(join(root, 'owned'))
    const foreign = join(root, 'foreign'); await mkdir(foreign)
    await writeFile(join(foreign, 'secret.txt'), 'foreign data')
    await symlink(join(foreign, 'secret.txt'), join(workspace.root, 'link.txt'), 'file')
    await symlink(foreign, join(workspace.root, 'linked-directory'), 'dir')
    const context = { instanceId: 'i', runId: 'r', operationId: 'o', signal: new AbortController().signal, resource: () => workspace }
    const writer = builtins.find(c => c.id === 'workspace.write')!, reader = builtins.find(c => c.id === 'workspace.read')!
    await assert.rejects(writer.invoke!({ path: '../foreign/new.txt', content: 'bad' }, {}, context), /relative/)
    await assert.rejects(reader.invoke!({ path: 'link.txt' }, {}, context))
    await assert.rejects(writer.invoke!({ path: 'linked-directory/new.txt', content: 'bad' }, {}, context), /symlink|escapes/)
    await writer.invoke!({ path: 'result.txt', content: 'original' }, {}, context)
    await assert.rejects(writer.invoke!({ path: 'result.txt', content: 'overwrite' }, {}, context))
    assert.equal(await readFile(join(workspace.root, 'result.txt'), 'utf8'), 'original')
    assert.equal(await readFile(join(foreign, 'secret.txt'), 'utf8'), 'foreign data')
  } finally { await rm(root, { recursive: true, force: true }) }
})
