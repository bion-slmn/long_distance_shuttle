import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// @testing-library/react is supposed to auto-register a cleanup() call
// after each test, but that auto-detection didn't reliably fire in this
// project (each test's render() was stacking on top of the last, causing
// "Found multiple elements" errors that grew test-to-test). Registering
// it explicitly here is bulletproof regardless of framework detection.
afterEach(() => {
    cleanup();
});