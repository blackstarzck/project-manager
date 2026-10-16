import type { Preview } from '@storybook/react-vite';
import '../src/styles.css';
import '../src/design-tokens.css';
import '../src/workspace-theme.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    backgrounds: { options: { workspace: { name: '작업 배경', value: '#f5f6f8' } } },
  },
  initialGlobals: { backgrounds: { value: 'workspace' } },
};
export default preview;
