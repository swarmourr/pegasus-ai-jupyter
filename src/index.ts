import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';

import { ReactWidget, ToolbarButton } from '@jupyterlab/apputils';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { renderPegasusCell, isPegasusCell, setJupyterApp, setJupyterContext, PegasusPanelComponent, PegasusOpenCodePanelComponent } from './pegasusCell';
import React from 'react';

const PLUGIN_ID    = 'jupyterlab-pegasus:plugin';
const CMD_INSERT   = 'pegasus:insert-cell';
const CMD_PANEL    = 'pegasus:open-panel';
const CMD_OC_PANEL = 'pegasus:open-opencode-panel';

let _panelWidget:   ReturnType<typeof ReactWidget.create> | null = null;
let _ocPanelWidget: ReturnType<typeof ReactWidget.create> | null = null;
let _panelSeq = 0; // unique suffix to avoid stale ID conflicts after close

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [INotebookTracker],

  activate: (app: JupyterFrontEnd, tracker: INotebookTracker) => {
    console.log('JupyterLab Pegasus extension activated');
    setJupyterApp(app);

    const openPanel = (
      existing: ReturnType<typeof ReactWidget.create> | null,
      factory: () => ReturnType<typeof ReactWidget.create>,
      onDispose: () => void,
    ) => {
      if (existing && !existing.isDisposed && existing.isAttached) {
        app.shell.activateById(existing.id);
        return existing;
      }
      // Disposed or detached (closed) — clean up before recreating
      if (existing && !existing.isDisposed) existing.dispose();
      const ref = tracker.currentWidget?.id;
      const w = factory();
      w.disposed.connect(onDispose);
      app.shell.add(w, 'main', { mode: 'split-right', ref });
      app.shell.activateById(w.id);
      return w;
    };

    app.commands.addCommand(CMD_PANEL, {
      label: 'Open Pegasus Chat Panel',
      caption: 'Open Pegasus AI assistant as a side panel',
      execute: () => {
        _panelWidget = openPanel(
          _panelWidget,
          () => {
            const w = ReactWidget.create(React.createElement(PegasusPanelComponent));
            w.id = `pegasus-chat-panel-${++_panelSeq}`;
            w.title.label = '⬡ Pegasus Chat';
            w.title.closable = true;
            return w;
          },
          () => { _panelWidget = null; },
        );
      },
    });

    app.commands.addCommand(CMD_OC_PANEL, {
      label: 'Open Pegasus Assistant Panel',
      caption: 'Open an embedded OpenCode terminal with Pegasus skill context',
      execute: () => {
        _ocPanelWidget = openPanel(
          _ocPanelWidget,
          () => {
            const w = ReactWidget.create(React.createElement(PegasusOpenCodePanelComponent));
            w.id = `pegasus-opencode-panel-${++_panelSeq}`;
            w.title.label = 'OpenCode for Pegasus';
            w.title.closable = true;
            return w;
          },
          () => { _ocPanelWidget = null; },
        );
      },
    });

    app.commands.addCommand(CMD_INSERT, {
      label: 'Insert Pegasus Cell',
      caption: 'Insert an AI-powered Pegasus workflow cell',
      execute: () => {
        const notebook = tracker.currentWidget;
        if (!notebook) return;
        const notebookPanel = notebook.content;

        NotebookActions.insertBelow(notebookPanel);

        const activeCell = notebookPanel.activeCell;
        if (!activeCell) return;

        // JupyterLab 4: metadata is a plain object accessed via .set/.get on the model
        const model = activeCell.model;
        const metadata = model.getMetadata('pegasus');
        if (!metadata) {
          model.setMetadata('pegasus', {
            agent: 'workflow-architect',
            skill: 'scaffold',
            messages: [],
          });
        }

        model.sharedModel.setSource('# Pegasus cell');
        // defer until the cell DOM is fully in the page
        requestAnimationFrame(() => renderPegasusCell(activeCell));
      },
    });

    app.contextMenu.addItem({
      command: CMD_INSERT,
      selector: '.jp-Notebook',
      rank: 10,
    });

    // Keyboard shortcuts
    app.commands.addKeyBinding({ command: CMD_PANEL,    keys: ['Ctrl Shift P'], selector: 'body' });
    app.commands.addKeyBinding({ command: CMD_OC_PANEL, keys: ['Ctrl Shift A'], selector: 'body' });

    // Keep JupyterContext in sync with the active notebook + cell
    const updateContext = () => {
      const panel = tracker.currentWidget;
      if (!panel) return;
      const filePath = panel.context.path;
      const parts = filePath.split('/');
      const notebookDir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
      const cellSource = tracker.activeCell?.model.sharedModel.getSource() ?? '';
      // Collect all cell sources for full notebook context
      const cells = panel.content.widgets;
      const notebookCells = cells.map((c, i) =>
        `# Cell ${i + 1}\n${c.model.sharedModel.getSource()}`
      ).join('\n\n');
      setJupyterContext({ filePath, notebookDir, cellSource, notebookCells });
    };

    tracker.currentChanged.connect(updateContext);
    tracker.activeCellChanged.connect(updateContext);

    // Detect failed cell executions and store error in context
    NotebookActions.executed.connect((_, args: any) => {
      if (args.success) { setJupyterContext({ lastError: '' }); return; }
      const outputs: any[] = args.cell?.model?.outputs?.toJSON?.() ?? [];
      const err = outputs.find((o: any) => o.output_type === 'error');
      if (err) {
        const tb = (err.traceback as string[] ?? [])
          .map((l: string) => l.replace(/\x1b\[[0-9;]*m/g, ''))
          .join('\n');
        setJupyterContext({ lastError: `${err.ename}: ${err.evalue}\n${tb}` });
      }
    });

    tracker.widgetAdded.connect((_, notebookPanel) => {
      const btn = new ToolbarButton({
        label: '⬡ Pegasus Chat',
        tooltip: 'Open Pegasus Chat Panel',
        onClick: () => app.commands.execute(CMD_PANEL),
      });
      notebookPanel.toolbar.insertItem(10, 'pegasus:panel', btn);

      const btnOC = new ToolbarButton({
        label: '⬡ Pegasus Assistant',
        tooltip: 'Open Pegasus + OpenCode Panel',
        onClick: () => app.commands.execute(CMD_OC_PANEL),
      });
      notebookPanel.toolbar.insertItem(11, 'pegasus:opencode-panel', btnOC);

      const notebook = notebookPanel.content;

      // render existing Pegasus cells once the notebook panel is fully revealed
      notebookPanel.revealed.then(() => {
        notebook.widgets.forEach(cell => {
          if (isPegasusCell(cell)) {
            renderPegasusCell(cell);
          }
        });
      });

      notebook.model?.cells.changed.connect(() => {
        requestAnimationFrame(() => {
          notebook.widgets.forEach(cell => {
            if (isPegasusCell(cell) && !cell.node.querySelector('.jp-pegasus-cell')) {
              renderPegasusCell(cell);
            }
          });
        });
      });
    });
  },
};

export default plugin;