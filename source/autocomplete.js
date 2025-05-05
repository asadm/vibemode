// source/autocomplete.js
import React from 'react';
import Select from 'ink-select-input';
import TextInput from 'ink-text-input';
import { Box, Text } from 'ink';
import logger from './logger.js';

// Helpers -------------------------------------------------------------------
const noop = () => {};
const not = a => !a;
const isEmpty = arr => arr.length === 0;
// Removed: getMatchDefault helper function is no longer used

// AutoComplete --------------------------------------------------------------

const AutoComplete = ({
    value = '',
    placeholder = '',
    items = [], // Modified: Now expects pre-filtered items from parent
    // Removed: getMatch prop is no longer needed
    onChange = noop,
    onSubmit = noop,
    onSuggestionSelect = noop,
    indicatorComponent,
    itemComponent,
    limit,
}) => {
    // Modified: Items are assumed to be pre-filtered, no internal filtering needed
    const matches = items;
    const hasSuggestion = not(isEmpty(matches));

    // ... (handleDirectListSelect unchanged) ...
     const handleDirectListSelect = (item) => {
        onSuggestionSelect(item);
    };


    // ... (handleTextInputSubmit unchanged) ...
     const handleTextInputSubmit = (submittedValue) => {
        if (!hasSuggestion) {
            onSubmit(submittedValue);
        }
    };


    return (
        <Box flexDirection="column">
            {/* ... (TextInput unchanged) ... */}
             <Box>
                <TextInput
                    value={value}
                    placeholder={placeholder}
                    onChange={onChange}
                    onSubmit={handleTextInputSubmit}
                />
            </Box>


            {/* Suggestions List */}
            {hasSuggestion && (
                <Box marginTop={1}>
                    <Select
                        items={matches} // Modified: Use the pre-filtered 'matches' directly
                        onSelect={handleDirectListSelect}
                        focus={hasSuggestion}
                        indicatorComponent={indicatorComponent}
                        itemComponent={itemComponent}
                        limit={limit}
                    />
                </Box>
            )}
        </Box>
    );
};

export default AutoComplete;