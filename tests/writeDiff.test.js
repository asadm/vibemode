// tests/applyDiff.test.js

import test, { describe } from 'node:test';
import assert from 'node:assert';

// Import only the function we want to test directly
import { applyDiff } from '../source/writeDiff.js'; // Adjust path if needed

describe('applyDiff pure logic', () => {
    const initialContent = `Line 1
Line 2 with needle
Line 3 also contains needle
Line 4
`;

    // --- Success Scenarios ---

    test('should apply a single valid change', () => {
        const changes = `
<<<<<<< SEARCH
Line 2 with needle
=======
Line 2 was replaced
>>>>>>> REPLACE
`;
        const expectedContent = `Line 1
Line 2 was replaced
Line 3 also contains needle
Line 4
`;
        const result = applyDiff(initialContent, changes);
        assert.strictEqual(result, expectedContent);
    });

    test('should apply multiple valid changes sequentially', () => {
        const changes = `
<<<<<<< SEARCH
Line 2 with needle
=======
Line 2 REPLACED
>>>>>>> REPLACE

<<<<<<< SEARCH
Line 4
=======
LINE FOUR CHANGED
>>>>>>> REPLACE
`;
        const expectedContent = `Line 1
Line 2 REPLACED
Line 3 also contains needle
LINE FOUR CHANGED
`;
        const result = applyDiff(initialContent, changes);
        assert.strictEqual(result, expectedContent);
    });

    test('should replace only the first occurrence of a repeated search pattern', () => {
        const changes = `
<<<<<<< SEARCH
needle
=======
haystack
>>>>>>> REPLACE
`;
        const expectedContent = `Line 1
Line 2 with haystack
Line 3 also contains needle
Line 4
`;
        const result = applyDiff(initialContent, changes);
        assert.strictEqual(result, expectedContent);
    });

    test('should return original content if search and replace are identical', () => {
         const changes = `
<<<<<<< SEARCH
Line 2 with needle
=======
Line 2 with needle
>>>>>>> REPLACE
`;
         const result = applyDiff(initialContent, changes);
         assert.strictEqual(result, initialContent); // No change expected
     });

     test('should return original content if no changes are parsed (empty diff)', () => {
         const changes = ``;
         const result = applyDiff(initialContent, changes);
         assert.strictEqual(result, initialContent);
     });

     test('should return original content if no valid diff blocks are found', () => {
         const changes = `Some random text without markers.`;
         const result = applyDiff(initialContent, changes);
         assert.strictEqual(result, initialContent);
     });

    // --- Failure Scenarios ---

    test('should return error string if one change fails (search not found)', () => {
        const changes = `
<<<<<<< SEARCH
Line 2 with needle
=======
Line 2 REPLACED (won't fully apply)
>>>>>>> REPLACE

<<<<<<< SEARCH
THIS SEARCH WILL FAIL
=======
THIS REPLACE WONT HAPPEN
>>>>>>> REPLACE
`;
        const result = applyDiff(initialContent, changes);

        // Expect a string (error report)
        assert.strictEqual(typeof result, 'string', 'Expected result to be an error string');
        assert.match(result, /Failed to apply all patches:/, 'Error message prefix mismatch');
        assert.match(result, /Change #2 failed: Search pattern not found./, 'Error details mismatch for failure');
        assert.match(result, /--- Search Pattern ---\nTHIS SEARCH WILL FAIL\n----------------------/, 'Failed search pattern not included');
        // Importantly, the first change *should not* have been applied to the original content in the final returned error state
        // The function processes sequentially but returns the error report, not partially modified content.
    });

    // --- Edge Cases ---

     test('should handle empty original content correctly (failure)', () => {
        const changes = `
<<<<<<< SEARCH
find me
=======
replace me
>>>>>>> REPLACE
`;
        const result = applyDiff('', changes);
        assert.strictEqual(typeof result, 'string');
        assert.match(result, /Change #1 failed: Search pattern not found./);
        assert.match(result, /--- Search Pattern ---\nfind me\n----------------------/);
    });

    test('should handle empty original content correctly (success)', () => {
        const changes = `
<<<<<<< SEARCH

=======
some content
>>>>>>> REPLACE
`; // Replacing empty string
        const result = applyDiff('', changes);
        assert.strictEqual(result, 'some content');
    });

    // --- Whitespace Handling Tests (Based on Python examples) ---
    // NOTE: These tests define the DESIRED behavior for future implementation.
    // They WILL FAIL against the current exact-matching applyDiff.

    test('[Desired Behavior] should succeed when search block is missing necessary leading whitespace', () => {
      const originalContent = "    line1\n    line2\n    line3\n";
      // Search block lacks the 4-space indent
      const search = "line1\nline2\n";
      const replace = "new_line1\nnew_line2\n"; // Replacement preserves its own format
      const changes = `<<<<<<< SEARCH\n${search}=======\n${replace}>>>>>>> REPLACE`;

      // DESIRED outcome: The function finds the indented block and replaces it
      const expectedContent = "    new_line1\n    new_line2\n    line3\n";

      const result = applyDiff(originalContent, changes);
      // This assertion WILL FAIL with current applyDiff
      assert.strictEqual(result, expectedContent, 'Test failed: Expected replacement despite missing leading whitespace in search.');
  });

  test('[Desired Behavior] should succeed when search block has missing/varied leading whitespace', () => {
      const originalContent = `
  line1
  line2
      line3
  line4
`;
      // Search block lacks initial indent on line2 and has different indent for line3
      const search = "line2\n    line3\n";
      const replace = "new_line2\n    new_line3\n"; // Replacement preserves its own format
      const changes = `<<<<<<< SEARCH\n${search}=======\n${replace}>>>>>>> REPLACE`;

      // DESIRED outcome: The function finds the block despite varied indent and replaces it
      const expectedContent = `
  line1
  new_line2
      new_line3
  line4
`; // Note: Preserving surrounding whitespace/newlines and applying replacement structure

      const result = applyDiff(originalContent, changes);
       // This assertion WILL FAIL with current applyDiff
      assert.strictEqual(result, expectedContent, 'Test failed: Expected replacement despite varied leading whitespace in search.');
  });

   test('[Desired Behavior] should replace first match when search block misses leading whitespace (multiple matches)', () => {
      const originalContent = "    line1\n    line2\n    line1\n    line3\n";
      // Search block lacks the 4-space indent
      const search = "line1\n";
      const replace = "new_line\n";
      const changes = `<<<<<<< SEARCH\n${search}=======\n${replace}>>>>>>> REPLACE`;

      // DESIRED outcome: The function finds the *first* indented "line1" and replaces it
      const expectedContent = "    new_line\n    line2\n    line1\n    line3\n";

      const result = applyDiff(originalContent, changes);
       // This assertion WILL FAIL with current applyDiff
      assert.strictEqual(result, expectedContent, 'Test failed: Expected first match replacement despite missing leading whitespace.');
  });

  test('[Desired Behavior] should succeed when search block has *some* but not *all* required whitespace', () => {
      const originalContent = "    line1\n    line2\n    line3\n";
      // Search block has only 1 space indent, not the required 4
      const search = " line1\n line2\n";
      // Replacement block dictates its *own* final indentation relative to the matched line
      const replace = " new_line1\n     new_line2\n";
      const changes = `<<<<<<< SEARCH\n${search}=======\n${replace}>>>>>>> REPLACE`;

      // DESIRED outcome: Finds the match despite incorrect indent, applies replacement maintaining relative structure
      const expectedContent = "    new_line1\n        new_line2\n    line3\n";

      const result = applyDiff(originalContent, changes);
       // This assertion WILL FAIL with current applyDiff
      assert.strictEqual(result, expectedContent, 'Test failed: Expected replacement despite partially incorrect leading whitespace.');
  });

  test('[Desired Behavior] should succeed when missing leading whitespace including blank line', () => {
       const originalContent = "    line1\n    line2\n    line3\n";
       // Search block starts with blank line, then has incorrect indentation
       const search = "\n  line1\n  line2\n";
       // Replacement dictates its own structure/indentation
       const replace = "  new_line1\n  new_line2\n";
       const changes = `<<<<<<< SEARCH\n${search}=======\n${replace}>>>>>>> REPLACE`;

       // DESIRED outcome: Ignores whitespace discrepancies (including blank lines if appropriate) and finds match
       const expectedContent = "    new_line1\n    new_line2\n    line3\n"; // Assuming it finds line1/line2

       const result = applyDiff(originalContent, changes);
        // This assertion WILL FAIL with current applyDiff
       assert.strictEqual(result, expectedContent, 'Test failed: Expected replacement despite leading blank line and incorrect indent.');
  });

  test('should return error string for the first failure encountered', () => {
    const changes = `
<<<<<<< SEARCH
NON_EXISTENT_1
=======
REPLACE_1
>>>>>>> REPLACE

<<<<<<< SEARCH
Line 2 with needle
=======
Line 2 REPLACED (this won't be reached)
>>>>>>> REPLACE

<<<<<<< SEARCH
NON_EXISTENT_2
=======
REPLACE_2
>>>>>>> REPLACE
`;
    const result = applyDiff(initialContent, changes);
    assert.strictEqual(typeof result, 'string');
    assert.match(result, /Failed to apply all patches:/);
    // Check ONLY the first failure is reported
    assert.match(result, /Change #1 failed: Search pattern not found \(even ignoring whitespace\)/);
    assert.match(result, /--- Search Pattern ---\nNON_EXISTENT_1\n----------------------/);
    // Ensure subsequent potential failures or successes are NOT mentioned
    assert.doesNotMatch(result, /Change #2/);
    assert.doesNotMatch(result, /Change #3/);
    assert.doesNotMatch(result, /NON_EXISTENT_2/);
});

});