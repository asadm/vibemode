// source/autocomplete.js
import React from 'react';
import Select from 'ink-select-input'; // Import ItemProps type if using TS
import TextInput from 'ink-text-input';
import { Box, Text } from 'ink';
import logger from './logger.js';

// Helpers -------------------------------------------------------------------
const noop = () => {};
const not = a => !a;
const isEmpty = arr => arr.length === 0;
// Removed: getMatchDefault helper function is no longer used

// --- Added: Custom Item Component for Highlighting ---
// Helper function to merge overlapping/adjacent index pairs
const mergeIndices = (indices) => {
    if (!indices || indices.length === 0) {
        return [];
    }
    // Sort by start index
    indices.sort((a, b) => a[0] - b[0]);

    const merged = [indices[0]];

    for (let i = 1; i < indices.length; i++) {
        const current = indices[i];
        const last = merged[merged.length - 1];

        // If current overlaps or is adjacent to the last merged range
        if (current[0] <= last[1] + 1) {
            // Merge by extending the end of the last range if current ends later
            last[1] = Math.max(last[1], current[1]);
        } else {
            // No overlap, add current as a new range
            merged.push(current);
        }
    }
    return merged;
};


// Custom component to render each item in the Select list
const HighlightMatchItem = ({ isSelected, label, matches = [] }) => { // Destructure matches prop
    // Use the merged indices for rendering
    const mergedMatches = mergeIndices(matches);
    const segments = [];
    let lastIndex = 0;

    // Determine base color based on selection state
    const baseColor = isSelected ? 'blue' : undefined; // Use default color if not selected
    const highlightStyle = { bold: true, color: isSelected ? 'cyan' : 'green' }; // Style for matched parts

    mergedMatches.forEach(([start, end]) => {
        // Add segment before the current match (if any)
        if (start > lastIndex) {
            segments.push(
                <Text key={`pre-${start}`} color={baseColor}>
                    {label.substring(lastIndex, start)}
                </Text>
            );
        }
        // Add the highlighted segment
        segments.push(
            <Text key={`match-${start}`} {...highlightStyle}>
                {label.substring(start, end + 1)}
            </Text>
        );
        lastIndex = end + 1;
    });

    // Add any remaining part of the string after the last match
    if (lastIndex < label.length) {
        segments.push(
            <Text key="post-last" color={baseColor}>
                {label.substring(lastIndex)}
            </Text>
        );
    }

     // If label was empty or no matches somehow, render plain label
     if (segments.length === 0) {
         segments.push(<Text key="plain" color={baseColor}>{label}</Text>);
     }

    return <Box>{segments}</Box>;
};
// --- End Custom Item Component ---

// AutoComplete --------------------------------------------------------------
const AutoComplete = ({
    value = '',
    placeholder = '',
    items = [], // Expects items like { label: string, value: string, matches: Array<[number, number]> }
    onChange = noop,
    onSubmit = noop,
    onSuggestionSelect = noop,
    indicatorComponent,
    // itemComponent, // Removed from props, managed internally now
    limit,
}) => {
    // Modified: Items are assumed to be pre-filtered, no internal filtering needed
    const matches = items;
    const hasSuggestion = not(isEmpty(matches));

    // ... (handleDirectListSelect unchanged) ...
     const handleDirectListSelect = (item) => { // item here includes label, value, matches
        onSuggestionSelect(item); // Parent usually only needs item.label or item.value
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
                        itemComponent={HighlightMatchItem} // <-- Use the custom highlighting component
                        limit={limit}
                    />
                </Box>
            )}
        </Box>
    );
};

export default AutoComplete;