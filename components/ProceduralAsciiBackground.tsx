import React, { useState, useEffect, useMemo } from 'react';

const CHARS = ['·', '-', '|', '+', '/', '\\', '·', '·', '·'];
const GRID_SIZE = 25;

interface ProceduralAsciiBackgroundProps {
  width: number;
  height: number;
  tick: number;
  isIdle: boolean;
}

export const ProceduralAsciiBackground: React.FC<ProceduralAsciiBackgroundProps> = ({ width, height, tick, isIdle }) => {
    const [grid, setGrid] = useState<string[][]>([]);

    const cols = useMemo(() => Math.ceil(width / GRID_SIZE) + 2, [width]);
    const rows = useMemo(() => Math.ceil(height / GRID_SIZE) + 2, [height]);
    
    useEffect(() => {
        const newGrid = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => CHARS[Math.floor(Math.random() * CHARS.length)])
        );
        setGrid(newGrid);
    }, [rows, cols]);

    useEffect(() => {
        if (isIdle) { // Shimmer
            setGrid(prevGrid => {
                const nextGrid = prevGrid.map(row => [...row]);
                if(nextGrid.length > 0 && nextGrid[0].length > 0){
                    const shimmerCount = Math.floor(rows * cols / 200); // Shimmer ~0.5% of cells
                    for(let i=0; i<shimmerCount; i++) {
                        const r = Math.floor(Math.random() * nextGrid.length);
                        const c = Math.floor(Math.random() * nextGrid[0].length);
                        nextGrid[r][c] = CHARS[Math.floor(Math.random() * CHARS.length)];
                    }
                }
                return nextGrid;
            });
        }
    }, [tick, isIdle, rows, cols]);

    const scrollOffset = isIdle ? 0 : (tick * 2) % GRID_SIZE;

    if (grid.length === 0) return null;

    return (
        <g 
            transform={`translate(${-GRID_SIZE}, ${-GRID_SIZE + scrollOffset})`} 
            opacity="0.15" 
            className="font-mono text-ink pointer-events-none"
            style={{ transition: 'opacity 0.5s ease' }}
        >
            {grid.map((row, r) => (
                <text 
                    key={r} 
                    y={r * GRID_SIZE} 
                    fontSize={GRID_SIZE * 0.8} 
                    fill="currentColor"
                    letterSpacing="0"
                >
                    {row.join('')}
                </text>
            ))}
        </g>
    );
};
