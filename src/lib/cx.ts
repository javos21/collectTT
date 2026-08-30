import { extendTailwindMerge } from 'tailwind-merge';

export const cx = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display-xs', 'display-sm', 'display-md', 'display-lg'],
    },
  },
});
