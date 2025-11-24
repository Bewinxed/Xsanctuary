<script lang="ts">
  interface Props {
    type?: string;
    value?: string;
    placeholder?: string;
    class?: string;
    disabled?: boolean;
    oninput?: (e: Event) => void;
  }

  let { type = 'text', value = $bindable(''), placeholder = '', class: className = '', disabled = false, oninput }: Props = $props();
</script>

<input
  {type}
  bind:value
  {placeholder}
  {disabled}
  class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 {className}"
  oninput={oninput}
/>
