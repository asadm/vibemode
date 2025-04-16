// source/components/MainMenuUI.js
import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

const MainMenuUI = ({ statusMessage = "", onSelect }) => {
    const items = [
        { label: "Pack files (copy XML)", value: "pack" },
        { label: "Apply edits from paste", value: "apply" },
        { label: "Exit", value: "exit" },
    ];

    return (
        <Box flexDirection="column" padding={1} minWidth={60}>
            {statusMessage && (
                <Box paddingX={1} marginBottom={1} borderStyle="round" borderColor="yellow">
                    <Text color="yellow" wrap="wrap">{statusMessage}</Text>
                </Box>
            )}
            <Box flexDirection="column" padding={1} borderStyle="single">
                <Text bold>Select Action:</Text>
                <Box marginTop={1}>
                    <SelectInput items={items} onSelect={onSelect} />
                </Box>
            </Box>
        </Box>
    );
};


export default MainMenuUI;