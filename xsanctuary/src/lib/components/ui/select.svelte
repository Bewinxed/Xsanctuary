<script lang="ts">
  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    value?: string;
    options: Option[];
    class?: string;
    disabled?: boolean;
    onchange?: (e: Event) => void;
  }

  let { value = $bindable(''), options, class: className = '', disabled = false, onchange }: Props = $props();
</script>

<select
  bind:value
  {disabled}
  class="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 {className}"
  onchange={onchange}
>
  {#each options as option}
    <option value={option.value}>{option.label}</option>
  {/each}
</select>
