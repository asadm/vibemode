// source/AutoComplete.js
import React from "react"; // Import React explicitly
import { Box, Text } from "ink"; // Use Box and Text from ink directly
import PropTypes from "prop-types";
import SelectInput from "ink-select-input";
import InkTextInput from "ink-text-input"; // Renamed to avoid conflict
import logger from "./logger.js"; // Optional: for debugging

// Helpers
const noop = () => {};
const not = (a) => !a;
const isEmpty = (arr) => arr.length === 0;

// Default matcher (can be overridden by props)
const defaultGetMatch = (input) => ({ label }) =>
    input.length > 0 && label.toLowerCase().indexOf(input.toLowerCase()) > -1;

const AutoComplete = ({
    value = "",
    placeholder = "",
    items = [], // Expects { label: string, value: any }[]
    getMatch = defaultGetMatch, // Default simple matcher if not provided
    onChange = noop,
    onSelectSubmit = noop, // Renamed from onSubmit to be specific to selection
    onTextInputSubmit = noop, // New prop for direct text input submission
    indicatorComponent = SelectInput.defaultProps.indicatorComponent,
    itemComponent = SelectInput.defaultProps.itemComponent,
    selectLimit = 7, // Add a limit for suggestions
}) => {
    const matches = getMatch(value, items); // Pass items to getMatch
    const hasSuggestion = not(isEmpty(matches));
    const limitedMatches = matches.slice(0, selectLimit); // Limit displayed suggestions

    // Determine if the SelectInput should be focused.
    // Focus SelectInput only if there are suggestions AND the input value is not empty.
    // This prevents SelectInput from stealing focus when the input is cleared.
    const shouldFocusSelect = hasSuggestion && value.trim().length > 0;

    return (
        <Box flexDirection="column">
            {/* Input Box */}
            <Box>
                {/* Optional: Add a label if desired */}
                {/* <Text>Pattern: </Text> */}
                <InkTextInput
                    value={value}
                    placeholder={placeholder}
                    onChange={onChange}
                    onSubmit={onTextInputSubmit} // Use the new prop here
                    // Focus is managed implicitly by Ink based on rendering order/props
                    // or explicitly if needed, but let's try implicit first.
                />
            </Box>

            {/* Suggestions Box */}
            {/* Only render SelectInput if there are suggestions to avoid empty space */}
            {hasSuggestion && (
                <Box marginTop={1} marginLeft={2}> {/* Indent suggestions */}
                     <SelectInput
                        items={limitedMatches} // Use limited matches
                        onSelect={onSelectSubmit}
                        focus={shouldFocusSelect} // Conditionally focus SelectInput
                        indicatorComponent={indicatorComponent}
                        itemComponent={itemComponent}
                        limit={selectLimit} // Pass limit to SelectInput as well
                    />
                </Box>
            )}
        </Box>
    );
};

AutoComplete.propTypes = {
    value: PropTypes.string,
    placeholder: PropTypes.string,
    items: PropTypes.arrayOf(
        PropTypes.shape({
            label: PropTypes.string.isRequired,
            value: PropTypes.any.isRequired,
        })
    ),
    getMatch: PropTypes.func,
    onChange: PropTypes.func,
    onSelectSubmit: PropTypes.func, // Renamed prop
    onTextInputSubmit: PropTypes.func, // New prop
    indicatorComponent: PropTypes.func,
    itemComponent: PropTypes.func,
    selectLimit: PropTypes.number, // Prop for limiting suggestions
};

AutoComplete.defaultProps = {
    value: "",
    placeholder: "",
    items: [],
    getMatch: defaultGetMatch, // Default simple matcher if not provided
    onChange: noop,
    onSelectSubmit: noop,
    onTextInputSubmit: noop,
    indicatorComponent: SelectInput.defaultProps.indicatorComponent,
    itemComponent: SelectInput.defaultProps.itemComponent,
    selectLimit: 7, // Default limit
};

export default AutoComplete;