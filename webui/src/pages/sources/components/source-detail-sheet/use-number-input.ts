import * as React from "react";

const MIN_SCAN_LIMIT = 5;

export function useTextInput(initial: string) {
  const [value, setValue] = React.useState(initial);
  return {
    value,
    set: setValue,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(event.target.value),
  };
}

export function useNumberInput(initial: string) {
  const input = useTextInput(initial);
  return {
    value: input.value,
    set: input.set,
    onChange: input.onChange,
    clamped: (max: number) => Math.max(MIN_SCAN_LIMIT, Math.min(max, Number(input.value) || 20)),
  };
}

export type NumberInputState = ReturnType<typeof useNumberInput>;
