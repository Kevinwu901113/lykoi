/**
 * prompt sha256 对拍（SA-94/SA-138/SA-152 + 两条身份守卫 fixture 口径）。
 * 期望值逐条取自 WO-M2-SPEC-MIND §6.6 汇总表；chars 按 Python len（码点）口径。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { INTEGRATION_SYSTEM_PROMPT, integrationIdentityGuard } from '../src/l2.ts'
import { FOCUS_SYSTEM_PROMPT, focusIdentityGuard } from '../src/l4.ts'
import { STAGED_TEMPLATE } from '../src/l5.ts'
import { PERSONA } from './fixture.ts'

function pin(text: string, chars: number, sha256: string, label: string): void {
  assert.equal([...text].length, chars, `${label}: chars`)
  assert.equal(createHash('sha256').update(text, 'utf8').digest('hex'), sha256, `${label}: sha256`)
}

test('SA-94：INTEGRATION_SYSTEM_PROMPT 逐字（1862 字符，sha256=b130d647…2193c）', () => {
  pin(INTEGRATION_SYSTEM_PROMPT, 1862,
    'b130d6473ff9c2e8983f06cced5ca97ae837644886f5db2f6f38ddf31132193c',
    'INTEGRATION_SYSTEM_PROMPT')
})

test('SA-138：FOCUS_SYSTEM_PROMPT 逐字（1079 字符，sha256=c278a1ca…0918a）', () => {
  pin(FOCUS_SYSTEM_PROMPT, 1079,
    'c278a1ca6409ffc39bd299d760289063e64e90d41fdcdd71967ef59de8c0918a',
    'FOCUS_SYSTEM_PROMPT')
})

test('SA-152：STAGED_TEMPLATE 逐字（240 字符，sha256=c4d946b5…780af）', () => {
  pin(STAGED_TEMPLATE, 240,
    'c4d946b5e3814e2cbfc98e83310ad4e4958ce1c33ecdac6e821e44801d8780af',
    'STAGED_TEMPLATE')
})

test('integrator 身份守卫 fixture 口径（40 字符，sha256=ce69ae2a…）', () => {
  pin(integrationIdentityGuard(PERSONA), 40,
    'ce69ae2ae060645af4ee593f0e8d57d04da077675227bb81442ac07a49c0ae2a',
    'integration identity guard')
})

test('focus 身份守卫 fixture 口径（43 字符，sha256=79577116…）', () => {
  pin(focusIdentityGuard(PERSONA), 43,
    '79577116796a009c3841724b3691f3a65f7dbb05f828e808e2d0e2d14d2635ae',
    'focus identity guard')
})
