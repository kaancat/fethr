/**
 * Window Drag Test Utility for Fethr
 * 
 * This script adds testing functionality to verify window dragging behavior.
 * Run it in the browser console when testing the application.
 */

// Track drag position changes
let dragStartPosition = null;
let dragCurrentPosition = null;
let isDragging = false;
let dragDistance = 0;
let testActive = false;

// Test configuration
const MIN_DRAG_DISTANCE = 50; // Minimum distance considered a successful drag (pixels)
const TEST_DURATION = 10000; // Test duration in milliseconds

/**
 * Starts the window drag test
 */
function startDragTest() {
  if (testActive) {
    console.warn("Drag test is already running");
    return;
  }
  
  testActive = true;
  dragStartPosition = null;
  dragCurrentPosition = null;
  dragDistance = 0;
  
  // Add tracking listeners
  window.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  
  console.log('%c🧪 DRAG TEST STARTED: Please try dragging the window', 'background: blue; color: white; padding: 2px 5px; font-weight: bold');
  console.log('1. Click and hold anywhere in the window');
  console.log('2. Drag the window to a new position');
  console.log('3. Release the mouse button');
  console.log('The test will automatically end in 10 seconds');
  
  // Auto-end test after duration
  setTimeout(() => {
    if (testActive) {
      endDragTest();
    }
  }, TEST_DURATION);
}

/**
 * Ends the window drag test and reports results
 */
function endDragTest() {
  if (!testActive) {
    console.warn("No drag test is currently running");
    return;
  }
  
  // Remove event listeners
  window.removeEventListener('mousedown', handleMouseDown);
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
  
  // Report results
  console.log(`%c🧪 DRAG TEST COMPLETED`, 'background: blue; color: white; padding: 2px 5px; font-weight: bold');
  console.log(`Maximum drag distance detected: ${dragDistance}px`);
  
  if (dragDistance >= MIN_DRAG_DISTANCE) {
    console.log(`%c✅ DRAG TEST PASSED: Window appears to be draggable (moved ${dragDistance}px)`, 
      'background: green; color: white; padding: 2px 5px; font-weight: bold');
  } else {
    console.log(`%c❌ DRAG TEST FAILED: Window does not appear to be draggable (only moved ${dragDistance}px)`, 
      'background: red; color: white; padding: 2px 5px; font-weight: bold');
    console.log('Possible issues:');
    console.log('- Tauri window.startDragging() may not be triggering correctly');
    console.log('- Event handling may be incorrect');
    console.log('- Mouse events may not be propagating to the window manager');
  }
  
  testActive = false;
}

// Event handlers
function handleMouseDown(e) {
  dragStartPosition = { x: e.clientX, y: e.clientY };
  isDragging = true;
  console.log('🖱️ Mouse down detected', dragStartPosition);
}

function handleMouseMove(e) {
  if (!isDragging || !dragStartPosition) return;
  
  dragCurrentPosition = { x: e.clientX, y: e.clientY };
  const currentDistance = Math.sqrt(
    Math.pow(dragCurrentPosition.x - dragStartPosition.x, 2) + 
    Math.pow(dragCurrentPosition.y - dragStartPosition.y, 2)
  );
  
  if (currentDistance > dragDistance) {
    dragDistance = currentDistance;
  }
}

function handleMouseUp(e) {
  if (!isDragging) return;
  
  dragCurrentPosition = { x: e.clientX, y: e.clientY };
  console.log('🖱️ Mouse up detected', dragCurrentPosition);
  
  const finalDistance = Math.sqrt(
    Math.pow(dragCurrentPosition.x - dragStartPosition.x, 2) + 
    Math.pow(dragCurrentPosition.y - dragStartPosition.y, 2)
  );
  
  console.log(`Drag ended: moved ${finalDistance.toFixed(2)}px`);
  isDragging = false;
}

// Export for global access
window.FethrDragTest = {
  start: startDragTest,
  end: endDragTest
};

console.log('%c📋 Fethr Window Drag Test Utility Loaded', 'background: purple; color: white; padding: 2px 5px; font-weight: bold');
console.log('To run the test, type: FethrDragTest.start()');
console.log('To end the test early, type: FethrDragTest.end()'); 