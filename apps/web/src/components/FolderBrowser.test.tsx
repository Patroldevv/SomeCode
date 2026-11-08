import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FolderBrowser } from './FolderBrowser.tsx';
import { createWorkspaceApi } from '../lib/workspaceApi.ts';
import { setLanguageForTests } from '../i18n/index.ts';
beforeEach(()=>setLanguageForTests('en'));afterEach(()=>setLanguageForTests(null));
it('never selects a stale folder after the user edits or fails to open a path',async()=>{
  const onSelect=vi.fn();
  const api={...createWorkspaceApi('test'),folders:vi.fn().mockResolvedValueOnce({path:'/tmp/first',parent:'/tmp',entries:[]}).mockRejectedValueOnce(new Error('missing'))};
  render(<FolderBrowser api={api} onSelect={onSelect} onClose={()=>{}}/>);
  const use=await screen.findByRole('button',{name:'Use this folder'});
  await screen.findByDisplayValue('/tmp/first');
  fireEvent.change(screen.getByRole('textbox',{name:'Folder path'}),{target:{value:'/tmp/wrong'}});
  expect(use).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Open folder'}));
  await screen.findByRole('alert');
  expect(use).toBeDisabled();fireEvent.click(use);expect(onSelect).not.toHaveBeenCalled();
});
