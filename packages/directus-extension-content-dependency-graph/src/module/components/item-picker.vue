<template>
	<v-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" @esc="close">
		<v-card class="item-picker">
			<v-card-title>Which {{ singularName }} do you want to check?</v-card-title>
			<v-card-text>
				<v-input v-model="search" autofocus small placeholder="Search…">
					<template #prepend><v-icon name="search" small /></template>
				</v-input>

				<div class="results">
					<v-progress-circular v-if="loading" indeterminate small />
					<p v-else-if="error" class="error small">{{ error }}</p>
					<p v-else-if="items.length === 0" class="muted small">
						{{ search ? 'Nothing matches your search.' : `${name} has no items yet.` }}
					</p>
					<button v-for="item in items" v-else :key="item.pk" class="item" @click="pick(item)">
						<v-icon name="description" small />
						<span>{{ item.label }}</span>
					</button>
				</div>
			</v-card-text>
			<v-card-actions>
				<v-button secondary @click="close">Cancel</v-button>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { singular } from '../../shared/wording.js';
import { useNames } from '../use-names.js';

const props = defineProps({
	modelValue: { type: Boolean, default: false },
	collection: { type: String, required: true },
});

const emit = defineEmits(['update:modelValue', 'pick']);

const api = useApi();
const { collectionName } = useNames();
const search = ref('');
const items = ref([]);
const loading = ref(false);
const error = ref(null);
let timer = null;
let request = 0;

const name = computed(() => collectionName(props.collection));
const singularName = computed(() => singular(name.value.toLowerCase()));

async function load() {
	const current = ++request;
	loading.value = true;
	error.value = null;

	try {
		const { data } = await api.get(`/content-dependency-graph/browse/${encodeURIComponent(props.collection)}`, {
			params: { search: search.value.trim() || undefined, limit: 25 },
		});
		if (current !== request) return;
		items.value = data.items;
		if (data.redacted) error.value = `Items of ${name.value} can't be checked.`;
	} catch (err) {
		if (current === request) error.value = err?.response?.data?.errors?.[0]?.message ?? err.message;
	} finally {
		if (current === request) loading.value = false;
	}
}

function pick(item) {
	emit('pick', item);
	close();
}

function close() {
	emit('update:modelValue', false);
}

watch(
	() => [props.modelValue, props.collection],
	([open]) => {
		if (!open) return;
		search.value = '';
		load();
	},
	{ immediate: true },
);

watch(search, () => {
	clearTimeout(timer);
	timer = setTimeout(load, 300);
});
</script>

<style scoped>
.results {
	display: flex;
	flex-direction: column;
	gap: 2px;
	max-height: 50vh;
	margin-top: 12px;
	overflow-y: auto;
}

.item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px;
	text-align: left;
	color: var(--theme--foreground);
	background: none;
	border: none;
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	font: inherit;
	word-break: break-word;
}

.item:hover { background: var(--theme--background-subdued); }
.item .v-icon { color: var(--theme--foreground-subdued); }

p { margin: 0; }
.error { color: var(--theme--danger); }
.muted { color: var(--theme--foreground-subdued); }
.small { font-size: 13px; }
</style>
