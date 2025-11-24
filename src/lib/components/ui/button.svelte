<script lang="ts">
  import { tv, type VariantProps } from 'tailwind-variants';

  const buttonVariants = tv({
    base: 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-border bg-transparent hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  });

  type ButtonVariants = VariantProps<typeof buttonVariants>;

  interface Props {
    variant?: ButtonVariants['variant'];
    size?: ButtonVariants['size'];
    class?: string;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    onclick?: (e: MouseEvent) => void;
  }

  let { variant = 'default', size = 'default', class: className = '', disabled = false, type = 'button', onclick, children }: Props & { children?: any } = $props();
</script>

<button
  {type}
  {disabled}
  class={buttonVariants({ variant, size, class: className })}
  onclick={onclick}
>
  {@render children?.()}
</button>
