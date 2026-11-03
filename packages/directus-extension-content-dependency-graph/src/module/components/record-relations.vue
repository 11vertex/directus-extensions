<template>
	<div class="record-relations" :class="{ nested: depth > 0 }">
		<p v-if="groups.length === 0" class="muted small">Not linked to any other item.</p>

		<section v-for="group in groups" :key="group.key" class="group">
			<header v-tooltip="group.technical">
				<span class="title">{{ group.title }}</span>
				<span class="muted small">
					<template v-if="group.redacted">{{ group.total }} hidden</template>
					<template v-else-if="group.total > group.items.length">first {{ group.items.length }} of {{ group.total }}</template>
					<template v-else>{{ group.total }}</template>
				</span>
			</header>

			<ul v-if="group.items.length">
				<li v-for="item in group.items" :key="keyOf(item)">
					<div class="row">
						<button
							v-if="depth < MAX_DEPTH && item.exists !== false"
							class="toggle"
							:aria-label="expanded[keyOf(item)] ? 'Collapse' : 'Expand'"
							@click="toggle(item)"
						>
							<v-icon :name="expanded[keyOf(item)] ? 'expand_more' : 'chevron_right'" small />
						</button>
						<span v-else class="toggle-spacer" />

						<span class="label">{{ item.label }}</span>
						<span class="muted small">{{ collectionName(item.collection) }}</span>
						<span v-if="item.exists === false" class="missing small">missing</span>

						<span class="actions">
							<router-link v-if="routeOf(item)" :to="routeOf(item)" class="link small">Open</router-link>
							<button class="link small" @click="emit('check', item)">Check</button>
						</span>
					</div>

					<div v-if="expanded[keyOf(item)]" class="child">
						<v-progress-circular v-if="children[keyOf(item)]?.loading" indeterminate small />
						<p v-else-if="children[keyOf(item)]?.error" class="error small">{{ children[keyOf(item)].error }}</p>
						<record-relations
							v-else-if="children[keyOf(item)]?.data"
							:data="children[keyOf(item)].data"
							:depth="depth + 1"
							@check="emit('check', $event)"
						/>
					</div>
				</li>
			</ul>
		</section>
	</div>
</template>

<script setup>
import { computed, reactive } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { itemRoute } from '../../shared/links.js';
import { useNames } from '../use-names.js';

defineOptions({ name: 'RecordRelations' });

const MAX_DEPTH = 3;

const props = defineProps({
	data: { type: Object, required: true },
	depth: { type: Number, default: 0 },
});

const emit = defineEmits(['check']);

const api = useApi();
const { collectionName, fieldName } = useNames();
const expanded = reactive({});
const children = reactive({});

const groups = computed(() => {
	const own = props.data.record.collection;
	const uses = props.data.outgoing.map((group) => ({
		...group,
		key: `out:${group.id}`,
		title: `Uses · ${fieldName(own, group.field)}`,
		technical: `${group.id} · ${String(group.type).toUpperCase()}`,
	}));
	const usedBy = props.data.incoming.map((group) => ({
		...group,
		key: `in:${group.id}`,
		title: `Used by · ${collectionName(group.collection)} → ${fieldName(group.collection, group.field)}`,
		technical: `${group.id} · ${String(group.type).toUpperCase()}${group.onDelete ? ` · on delete ${group.onDelete}` : ''}`,
	}));
	return [...uses, ...usedBy].filter((group) => group.total > 0);
});

function keyOf(item) {
	return `${item.collection}\u0000${item.pk}\u0000${item.via?.pk ?? ''}`;
}

function routeOf(item) {
	return itemRoute(item.collection, item.pk);
}

async function toggle(item) {
	const key = keyOf(item);
	expanded[key] = !expanded[key];
	if (!expanded[key] || children[key]?.data) return;

	children[key] = { loading: true };
	try {
		const { data } = await api.get(
			`/content-dependency-graph/records/${encodeURIComponent(item.collection)}/${encodeURIComponent(item.pk)}`,
		);
		children[key] = { data };
	} catch (err) {
		children[key] = { error: err?.response?.data?.errors?.[0]?.message ?? err.message };
	}
}
</script>

<style scoped>
.record-relations {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.record-relations.nested {
	padding-left: 12px;
	border-left: 2px solid var(--theme--border-color-subdued);
}

p { margin: 0; }

.group {
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	padding: 8px 12px;
}

.group header {
	display: flex;
	justify-content: space-between;
	gap: 8px;
}

.title { font-weight: 600; }

ul {
	list-style: none;
	margin: 6px 0 0;
	padding: 0;
}

li + li { border-top: var(--theme--border-width) solid var(--theme--border-color-subdued); }

.row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	padding: 4px 0;
}

.label { word-break: break-word; }

.toggle {
	display: inline-flex;
	padding: 0;
	color: var(--theme--foreground-subdued);
	background: none;
	border: none;
	cursor: pointer;
}

.toggle-spacer { width: 18px; }

.actions {
	display: flex;
	gap: 10px;
	margin-left: auto;
}

.child { padding: 6px 0 6px 8px; }

.missing { color: var(--theme--danger); }

.link {
	padding: 0;
	color: var(--theme--primary);
	background: none;
	border: none;
	cursor: pointer;
	font: inherit;
}

.error { color: var(--theme--danger); }
.muted { color: var(--theme--foreground-subdued); }
.small { font-size: 13px; }
</style>
