import { clsx, type ClassValue } from 'clsx'

/**
 * Class joiner. `clsx` is already a dependency and handles the conditional
 * object/array forms every component here relies on.
 *
 * There is deliberately no tailwind-merge: these components take `className`
 * as an *addition*, and every variant is written so the caller's class wins by
 * being later in the string. Adding a merge step would be a new dependency for
 * a problem the API shape already avoids.
 */
export const cx = (...parts: ClassValue[]) => clsx(parts)
