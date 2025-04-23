import React from 'react';
import Editor from '../components/Editor';

const Home = () => {
    return (
        <div
            className="main-container"
            style={{
                height: '100vh', // Ensure the container occupies the full viewport height
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden', // Prevent unnecessary scrolling
                boxSizing: 'border-box', // Include padding and border in height calculation
            }}
        >
            <div
                style={{
                    flex: 1, // Ensure the wrapper fills the remaining space
                    display: 'flex', // Use flex to stretch the child
                    flexDirection: 'column',
                    margin: 0, // Remove any default margin
                    padding: 0, // Remove any default padding
                    overflow: 'hidden', // Prevent scrolling within the wrapper
                    height: '100vh', // Ensure the wrapper stretches to full viewport height
                }}
            >
                <div
                    style={{
                        flex: 1, // Ensure the inner wrapper fills the remaining space
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100%', // Ensure the inner wrapper stretches to full height
                    }}
                >
                    <Editor />
                </div>
            </div>
        </div>
    );
};

// Apply global styles to ensure no spacing issues
if (typeof window !== 'undefined') {
    document.documentElement.style.margin = '0';
    document.documentElement.style.padding = '0';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.height = '100vh';
}

export default Home;