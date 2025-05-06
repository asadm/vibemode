// tests/applyDiff.test.js

import test, { describe } from 'node:test';
import assert from 'node:assert';

// Import only the function we want to test directly
import { applyDiff } from '../source/writeDiff.js';
import { applyEdit } from '../source/editor.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const getFixturePath = (name) => path.join("tests", 'fixtures', name)

describe('editor e2e tests', () => {
    test('deep_indentation_sample.py change1', async () => {
        const input = readFileSync(getFixturePath("deep_indentation_sample.py"), 'utf-8');
        const changes = readFileSync(getFixturePath("deep_indentation_sample_change1.txt"), 'utf-8');
        const diff = await applyEdit(changes, "fixtures/deep_indentation_sample.py", input);
        const output = applyDiff(input, diff);
        assert.strictEqual(output,
            readFileSync(getFixturePath("deep_indentation_sample_change1.result.py"), 'utf-8'))
    });

    test('deep_indentation_sample.py change2', async () => {
        const input = readFileSync(getFixturePath("deep_indentation_sample.py"), 'utf-8');
        const changes = readFileSync(getFixturePath("deep_indentation_sample_change2.txt"), 'utf-8');
        const diff = await applyEdit(changes, "fixtures/deep_indentation_sample.py", input);
        const output = applyDiff(input, diff);
        assert.strictEqual(output,
            readFileSync(getFixturePath("deep_indentation_sample_change2.result.py"), 'utf-8'))
    });
});