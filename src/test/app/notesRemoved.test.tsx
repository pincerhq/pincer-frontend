/**
 * Notes is parked on `feat/notes-and-deploy-agent`: on this line its URLs are
 * ordinary unknown paths, the sidebar no longer links to it, and its global
 * quick-capture shortcut is not mounted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/dashboard/AppSidebar';

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('Notes removed', () => {
  it.each(['/notes', '/notes/daily', '/notes/note_q2_kickoff'])('%s shows Not Found', async (path) => {
    window.history.pushState({}, '', path);
    render(<App />);
    expect(await screen.findByText('Page Not Found')).toBeInTheDocument();
  });

  it('has no quick-capture shortcut', async () => {
    window.history.pushState({}, '', '/login');
    render(<App />);
    fireEvent.keyDown(window, { key: 'N', metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true, shiftKey: true });
    expect(screen.queryByPlaceholderText(/capture a thought/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leaves only Telephony in the sidebar Apps group', () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /telephony/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^notes$/i })).not.toBeInTheDocument();
  });
});
