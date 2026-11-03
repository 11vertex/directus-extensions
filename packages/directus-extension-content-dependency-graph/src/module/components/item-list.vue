<template>
	<ul class="item-list">
		<li v-for="item in items" :key="item.pk">
			<span class="label">{{ item.label }}</span>
			<span class="actions">
				<router-link v-if="routeOf(item)" :to="routeOf(item)" class="link small">Open</router-link>
				<button class="link small" @click="emit('check', item)">Check</button>
			</span>
		</li>
		<li v-if="total > items.length" class="muted small">…and {{ total - items.length }} more</li>
	</ul>
</template>

<script setup>
import { itemRoute } from '../../shared/links.js';

const props = defineProps({
	items: { type: Array, required: true },
	total: { type: Number, required: true },
	collection: { type: String, required: true },
});

const emit = defineEmits(['check']);

function routeOf(item) {
	return itemRoute(props.collection, item.pk);
}
</script>

<style scoped>
.item-list {
	list-style: none;
	margin: 6px 0 0 26px;
	padding: 0;
}

li {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	padding: 4px 0;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.label { word-break: break-word; }

.actions {
	display: flex;
	gap: 10px;
	margin-left: auto;
}

.link {
	padding: 0;
	color: var(--theme--primary);
	background: none;
	border: none;
	cursor: pointer;
	font: inherit;
}

.muted { color: var(--theme--foreground-subdued); }
.small { font-size: 13px; }
</style>
