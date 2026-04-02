import { randomUUID } from 'crypto';

export type ActionType = 'navigate' | 'click' | 'type' | 'select' | 'scroll' | 'wait';

export interface RecordedAction {
  id: string;
  action: ActionType;
  selector?: string;
  url?: string;
  value?: string;
  timestamp: number;
  pageTitle?: string;
}

export interface RecorderSummary {
  count: number;
  actions_by_type: Record<ActionType, number>;
  urls_visited: string[];
}

export class ActionRecorder {
  private actions: RecordedAction[] = [];

  addAction(
    action: Omit<RecordedAction, 'id' | 'timestamp'> & { timestamp?: number }
  ): RecordedAction {
    const recorded: RecordedAction = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...action,
    };
    this.actions.push(recorded);
    return recorded;
  }

  getActions(): RecordedAction[] {
    return [...this.actions];
  }

  getLastAction(): RecordedAction | undefined {
    return this.actions[this.actions.length - 1];
  }

  clear(): void {
    this.actions = [];
  }

  getSummary(): RecorderSummary {
    const actions_by_type: Record<ActionType, number> = {
      navigate: 0,
      click: 0,
      type: 0,
      select: 0,
      scroll: 0,
      wait: 0,
    };

    const urlSet = new Set<string>();

    for (const a of this.actions) {
      actions_by_type[a.action] = (actions_by_type[a.action] ?? 0) + 1;
      if (a.url) urlSet.add(a.url);
    }

    return {
      count: this.actions.length,
      actions_by_type,
      urls_visited: Array.from(urlSet),
    };
  }

  toJSON(): string {
    return JSON.stringify(
      {
        session: {
          recorded_at: new Date().toISOString(),
          total_actions: this.actions.length,
        },
        actions: this.actions,
      },
      null,
      2
    );
  }
}
