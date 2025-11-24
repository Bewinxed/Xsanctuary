<script lang="ts">
  interface Props {
    class?: string;
  }

  let { class: className = '', children }: Props & { children?: any } = $props();
</script>

<div class="rounded-lg border border-border bg-card text-card-foreground shadow-sm {className}">
  {@render children?.()}
</div>
