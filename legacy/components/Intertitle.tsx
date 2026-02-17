import React, { useState, useEffect } from 'react';

type IntertitleStyle = 'page' | 'terminal' | 'writer';

interface IntertitleProps {
    text: string;
    speed: number; // ms per character
    isTyping: boolean;
    fontSize: number; // in rem
    style: IntertitleStyle;
    opacity: number;
}

export const Intertitle: React.FC<IntertitleProps> = ({ text, speed, isTyping, fontSize, style, opacity }) => {
    const [displayedText, setDisplayedText] = useState('');
    
    useEffect(() => {
        setDisplayedText(''); 
        if (!isTyping && style !== 'writer') { // In writer mode, we might want to re-type
            setDisplayedText(text);
            return;
        }

        if (isTyping || style === 'writer') {
            let i = 0;
            const textToDisplay = (isTyping || style !== 'writer') ? '' : text;
            setDisplayedText(textToDisplay);
            
            const timer = setInterval(() => {
                if (i < text.length) {
                    setDisplayedText(prev => prev + text.charAt(i));
                    i++;
                } else {
                    clearInterval(timer);
                }
            }, speed);
            
            return () => clearInterval(timer);
        } else {
             setDisplayedText(text);
        }

    }, [text, speed, isTyping, style]);
    
    const isDoneTyping = displayedText.length >= text.length;

    const wrapperClasses = 'absolute inset-0 z-[200] flex items-center justify-center p-8 pointer-events-none animate-in fade-in duration-300';
    
    const cursorHeight = style === 'terminal' || style === 'writer' ? fontSize * 0.8 : fontSize;
    const terminalCursorClasses = `inline-block animate-cursor-blink align-bottom bg-lime-400 w-2`;
    const pageCursorClasses = `inline-block animate-cursor-blink align-bottom bg-black w-1 md:w-2 ml-2`;
    const writerCursorClasses = `inline-block animate-cursor-blink align-bottom bg-white w-2`;

    if (style === 'writer') {
        return (
            <div className="absolute inset-0 z-[200] p-8 pointer-events-none animate-in fade-in duration-300" style={{ backgroundColor: `rgba(0, 0, 0, ${opacity})` }}>
                <div className="w-full h-full">
                    <p className="whitespace-pre-wrap break-words text-white font-mono text-left w-full" style={{ fontSize: `${fontSize}rem`, lineHeight: '1.2', color: `rgba(255,255,255, ${opacity})` }}>
                        {displayedText}
                        <span className={writerCursorClasses} style={{ height: `${cursorHeight}rem` }}></span>
                    </p>
                </div>
            </div>
        );
    }
    
    if (style === 'terminal') {
        return (
            <div className={wrapperClasses}>
                <div 
                    className="w-full max-w-4xl p-6 rounded-lg shadow-2xl border border-black/20"
                    style={{ backgroundColor: `rgba(10, 15, 20, ${opacity * 0.9})` }}
                >
                    <p className="whitespace-pre-wrap break-words text-lime-400 font-mono text-left w-full" style={{ fontSize: `${fontSize}rem`, lineHeight: '1.2' }}>
                        {displayedText}
                        {isTyping && !isDoneTyping && <span className={terminalCursorClasses} style={{ height: `${cursorHeight}rem` }}></span>}
                    </p>
                </div>
            </div>
        );
    }
    
    // Page Style
    return (
        <div className={wrapperClasses}>
            <div className="w-full max-w-4xl">
                <p 
                    className="whitespace-pre-wrap break-words font-archaic text-center"
                    style={{ 
                        fontSize: `${fontSize}rem`, 
                        lineHeight: '1.2',
                        color: `rgba(17, 24, 39, ${opacity})` // ink color with opacity
                    }}
                >
                    {displayedText}
                    {isTyping && !isDoneTyping && <span className={pageCursorClasses} style={{ height: `${cursorHeight}rem`, backgroundColor: `rgba(17, 24, 39, ${opacity})` }}></span>}
                </p>
            </div>
        </div>
    );
};
