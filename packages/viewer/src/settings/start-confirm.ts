// Nucleus's start without a Confirm in words (NU8, decisions 783, 786): what Settings' switch on
// Nucleus's page says, in the name Hive mode gives it. Pure.

/** `GET /api/nucleus/start-confirm`: what holds now, the person's own choice, Hive mode. */
export interface StartConfirmState {
  withoutConfirm: boolean;
  own: boolean;
  hive: boolean;
}

/** The line under the switch: what it does, or why it is on and fixed while Hive is on. */
export function startConfirmNote(state: StartConfirmState, name: string): string {
  if (state.hive) {
    return `On while Hive mode is on: ${name} starts workspaces without asking you. Your own choice (${
      state.own ? 'on' : 'off'
    }) holds again when Hive is off.`;
  }
  return `${state.withoutConfirm ? `${name} starts` : `With it on, ${name} starts`} a workspace at once, without asking you. Starting an agent again, verdicts, merges and clean-ups still wait for your Confirm. This repository only, kept out of git.`;
}
