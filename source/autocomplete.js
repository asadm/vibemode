// source/autocomplete.js
import React from 'react';
import Select from 'ink-select-input';
import TextInput from 'ink-text-input';
import { Box, Text } from 'ink';

// Helpers -------------------------------------------------------------------
const noop = () => {};
const not = a => !a;
const isEmpty = arr => arr.length === 0;
const getMatchDefault = input => ({label}) => input.length > 0 && label.toLowerCase().startsWith(input.toLowerCase());

// AutoComplete --------------------------------------------------------------

const AutoComplete = ({
    value = '',
    placeholder = '',
    items = [],
    getMatch = getMatchDefault,
    onChange = noop,
    onSubmit = noop,           // Renamed: For submitting the TEXT value (when no suggestions)
    onSuggestionSelect = noop, // For selecting a suggestion (click OR Enter on first)
    indicatorComponent,
    itemComponent,
    limit,
}) => {
    const matches = items.filter(getMatch(value));
    const hasSuggestion = not(isEmpty(matches));

    // Handler specifically for when an item is selected from the list *directly*
    const handleDirectListSelect = (item) => {
        onSuggestionSelect(item); // Call the parent's handler
    };

    // Handler for when Enter is pressed within the TextInput
    const handleTextInputSubmit = () => {
        if (hasSuggestion && matches.length > 0) {
            // If suggestions exist, treat Enter as selecting the *first* suggestion
            onSuggestionSelect(matches[0]);
        } else {
            // Otherwise (no suggestions), submit the current text value
            onSubmit(value);
        }
    };

    return (
        <Box flexDirection="column">
            {/* Text Input */}
            <Box>
                <TextInput
                    value={value}
                    placeholder={placeholder}
                    onChange={onChange}
                    onSubmit={handleTextInputSubmit} // Use the new conditional handler
                />
            </Box>

            {/* Suggestions List */}
            {hasSuggestion && (
                <Box marginTop={1}>
                    <Select
                        items={matches}
                        onSelect={handleDirectListSelect} // Use specific handler for clicks
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

// ---------------------------------------------------------------------------