<template>
	<span v-if="unknown" class="muted">(not saved)</span>
	<details v-else-if="display.long">
		<summary>Show value</summary>
		<pre>{{ display.text }}</pre>
	</details>
	<span v-else :class="{ muted: display.text === '(empty)' }">{{ display.text }}</span>
</template>

<script setup>
import { computed } from 'vue';
import { displayValue } from '../shared/change-text.js';

const props = defineProps({
	value: { type: null, default: null },
	path: { type: String, default: '' },
	stepNames: { type: Object, default: () => ({}) },
	unknown: { type: Boolean, default: false },
});

const display = computed(() => displayValue(props.value, props.path, props.stepNames));
</script>

<style scoped>
summary {
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	font-size: 13px;
}

pre {
	font-family: var(--theme--fonts--monospace--font-family), monospace;
	font-size: 12px;
	background: var(--theme--background-subdued);
	padding: 8px;
	border-radius: var(--theme--border-radius);
	overflow: auto;
	max-height: 240px;
	margin: 4px 0 0;
	white-space: pre-wrap;
	word-break: break-word;
}

span {
	word-break: break-word;
}

.muted {
	color: var(--theme--foreground-subdued);
}
</style>
