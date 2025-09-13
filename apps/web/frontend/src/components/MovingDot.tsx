import React, { useEffect, useState, useRef } from 'react';

// Global array to track all dot positions
let allDotPositions: Array<{x: number, y: number, id: string}> = [];

const MovingDot = () => {
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [isMoving, setIsMoving] = useState(false);
  const [trail, setTrail] = useState<Array<{x: number, y: number, opacity: number}>>([]);
  const animationRef = useRef<number>();
  const dotId = useRef<string>(Math.random().toString(36).substr(2, 9));

  const isPositionOccupied = (x: number, y: number, minDistance: number = 60) => {
    return allDotPositions.some(pos => {
      if (pos.id === dotId.current) return false;
      const distance = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2));
      return distance < minDistance;
    });
  };

  const getRandomPosition = () => {
    let attempts = 0;
    let newX, newY;
    
    do {
      newX = Math.random() * (window.innerWidth - 20) + 10;
      newY = Math.random() * (window.innerHeight - 20) + 10;
      attempts++;
    } while (isPositionOccupied(newX, newY) && attempts < 50);
    
    return { x: newX, y: newY };
  };

  useEffect(() => {
    const moveDot = () => {
      setIsMoving(true);
      const targetPosition = getRandomPosition();
      
      const startX = position.x;
      const startY = position.y;
      const startTime = Date.now();
      const duration = 3000; // 3 seconds
      
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Create curved path using sine wave
        const curveOffset = Math.sin(progress * Math.PI * 2) * 50;
        
        const currentX = startX + (targetPosition.x - startX) * progress + curveOffset;
        const currentY = startY + (targetPosition.y - startY) * progress + Math.sin(progress * Math.PI * 3) * 30;
        
        setPosition({ x: currentX, y: currentY });
        
        // Add to trail
        setTrail(prevTrail => {
          const newTrail = [...prevTrail, { x: currentX, y: currentY, opacity: 1 }];
          // Keep only last 8 trail points and fade them
          return newTrail.slice(-8).map((point, index) => ({
            ...point,
            opacity: (index + 1) / 8 * 0.6 // Fade from 0.6 to 0.075
          }));
        });
        
        // Update global position tracking
        const currentIndex = allDotPositions.findIndex(pos => pos.id === dotId.current);
        if (currentIndex !== -1) {
          allDotPositions[currentIndex] = { x: currentX, y: currentY, id: dotId.current };
        } else {
          allDotPositions.push({ x: currentX, y: currentY, id: dotId.current });
        }
        
        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          setIsMoving(false);
        }
      };
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    // Initialize position
    const initialPosition = getRandomPosition();
    setPosition(initialPosition);
    allDotPositions.push({ x: initialPosition.x, y: initialPosition.y, id: dotId.current });
    
    // Start moving after a random delay
    const initialDelay = Math.random() * 2000;
    setTimeout(() => {
      moveDot();
      const interval = setInterval(moveDot, 4000);
      
      return () => {
        clearInterval(interval);
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, initialDelay);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      // Remove this dot from global tracking
      allDotPositions = allDotPositions.filter(pos => pos.id !== dotId.current);
    };
  }, []);

  return (
    <>
      {/* Trail effect */}
      {trail.map((trailPoint, index) => (
        <div
          key={`${dotId.current}-trail-${index}`}
          style={{
            position: 'absolute',
            left: trailPoint.x,
            top: trailPoint.y,
            width: 3,
            height: 3,
            borderRadius: '50%',
            background: `rgba(255, 255, 255, ${trailPoint.opacity})`,
            boxShadow: `0 0 8px rgba(255, 255, 255, ${trailPoint.opacity * 0.5})`,
            transform: `scale(${0.5 + trailPoint.opacity * 0.5})`,
            transition: 'opacity 0.1s ease, transform 0.1s ease'
          }}
        />
      ))}
      
      {/* Main dot */}
      <div
        style={{
          position: 'absolute',
          left: position.x,
          top: position.y,
          width: 4,
          height: 4,
          borderRadius: '50%',
          background: isMoving ? 'rgba(255, 255, 255, 0.9)' : 'white',
          boxShadow: isMoving 
            ? '0 0 15px rgba(255, 255, 255, 0.8), 0 0 30px rgba(255, 255, 255, 0.4)' 
            : '0 0 8px rgba(255, 255, 255, 0.6)',
          transform: isMoving ? 'scale(1.8)' : 'scale(1)',
          transition: 'transform 0.3s ease, box-shadow 0.3s ease'
        }}
      />
    </>
  );
};

export default MovingDot;
