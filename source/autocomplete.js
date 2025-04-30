// source/autocomplete.js
import React from 'react';
import Select from 'ink-select-input';
import TextInput from 'ink-text-input';
import { Box, Text } from 'ink';
import logger from './logger.js'; // Added for debugging potential double calls

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
    onSubmit = noop,           // For submitting the TEXT value (when no suggestions)
    onSuggestionSelect = noop, // For selecting a suggestion (click OR Enter/Select action)
    indicatorComponent,
    itemComponent,
    limit,
}) => {
    const matches = items.filter(getMatch(value));
    const hasSuggestion = not(isEmpty(matches));

    // Handler specifically for when an item is selected from the list (click or Enter on highlighted item)
    const handleDirectListSelect = (item) => {
        // logger.info(`AutoComplete: handleDirectListSelect called with: ${JSON.stringify(item)}`); // Debug
        onSuggestionSelect(item); // Call the parent's handler
    };

    // Handler for when Enter is pressed *within the TextInput*
    const handleTextInputSubmit = (submittedValue) => { // submittedValue is passed by ink-text-input
        // logger.info(`AutoComplete: handleTextInputSubmit called with: ${submittedValue}, hasSuggestion: ${hasSuggestion}`); // Debug

        // *** MODIFIED LOGIC ***
        // Only call the parent's onSubmit (for raw text) if there are NO suggestions.
        // If suggestions ARE visible, pressing Enter in the TextInput itself should
        // ideally do nothing, letting the Select component handle the Enter press
        // via its own onSelect mechanism (which triggers handleDirectListSelect).
        if (!hasSuggestion) {
            onSubmit(submittedValue);
        }
        // Implicitly do nothing if suggestions are present, assuming Select handles it.
    };

    return (
        <Box flexDirection="column">
            {/* Text Input */}
            <Box>
                <TextInput
                    value={value}
                    placeholder={placeholder}
                    onChange={onChange}
                    // Pass the actual submitted value to the handler
                    onSubmit={(submittedValue) => handleTextInputSubmit(submittedValue)}
                />
            </Box>

            {/* Suggestions List */}
            {hasSuggestion && (
                <Box marginTop={1}>
                    <Select
                        items={matches}
                        onSelect={handleDirectListSelect} // Use specific handler for Select actions
                        focus={hasSuggestion} // Let Select handle focus and Enter when visible
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