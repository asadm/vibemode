// source/components/StatusDisplay.js
import React from 'react';
import { Box, Text } from 'ink';
import PropTypes from 'prop-types';

const StatusDisplay = ({ mode, statusMessage }) => {
    const borderColor = mode === "error" ? "red" : (mode === "done" ? "green" : "yellow");
    const defaultMessage = mode === "processing" ? "Processing..." : (mode === "done" ? "Done." : "Error.");
    const message = statusMessage || defaultMessage;

    return (
        <Box padding={1} borderStyle="round" borderColor={borderColor} minWidth={60}>
            <Text color={borderColor} wrap="wrap">{message}</Text>
        </Box>
    );
};

StatusDisplay.propTypes = {
    mode: PropTypes.oneOf(['processing', 'done', 'error']).isRequired,
    statusMessage: PropTypes.string,
};

StatusDisplay.defaultProps = {
    statusMessage: "",
};

export default StatusDisplay;