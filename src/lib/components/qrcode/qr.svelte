<script lang="ts">
  import { onMount } from "svelte";
  import QrCode from "qrcode-svg";

  interface Props extends QrCode.Options {}

  const opt: Props = $props();

  let svg = $state<string>();

  onMount(() => {
    svg = new QrCode({
      background: "transparent",
      color: "currentcolor",
      // SVGs with a viewBox but no explicit size default to 0×0 in browsers.
      container: "svg",
      width: 256,
      height: 256,
      padding: 0,
      ...opt,
    }).svg();
  });
</script>

{#if svg}
  {@html svg}
{/if}
