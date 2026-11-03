<template>
	<div class="health-check">
		<section class="numbers">
			<div v-for="number in numbers" :key="number.label" class="number">
				<strong :class="number.tone">{{ number.value }}</strong>
				<span class="muted small">{{ number.label }}</span>
			</div>
		</section>

		<section class="panel">
			<header>
				<h3 class="type-label">Unused or broken content</h3>
				<span v-if="running" class="muted small progress">
					<v-progress-circular indeterminate x-small /> Checking {{ doneCount + 1 }} of {{ queued.length }}…
				</span>
			</header>

			<p v-if="targets.length === 0" class="muted">No collection has links yet, so there is nothing to check.</p>

			<details v-for="finding in findings" :key="finding.key" class="finding">
				<summary class="line" :class="finding.tone">
					<v-icon :name="ICONS[finding.tone]" small />
					<span>{{ finding.text }}</span>
					<button class="link small" @click.prevent="emit('select', finding.collection)">See links</button>
				</summary>
				<p v-if="finding.items.length === 0" class="muted small indent">Items of this collection are hidden.</p>
				<item-list
					v-else
					:items="finding.items"
					:total="finding.total"
					:collection="finding.collection"
					@check="emit('check', { collection: finding.collection, pk: $event.pk })"
				/>
			</details>

			<p v-for="failure in failures" :key="failure.collection" class="line danger small">
				<v-icon name="error" small /> Couldn't check {{ collectionName(failure.collection) }}: {{ failure.error }}
			</p>

			<p v-if="cleanCount > 0" class="line success small">
				<v-icon name="check_circle" small />
				{{ findings.length ? `No problems in the other ${cleanCount}` : `No problems in ${cleanCount}` }}
				checked collection{{ cleanCount === 1 ? '' : 's' }}.
			</p>

			<v-button v-if="!running && remaining.length" small secondary @click="scan(remaining)">
				Check {{ remaining.length }} more collection{{ remaining.length === 1 ? '' : 's' }}
			</v-button>

			<p class="legend muted small">
				<span class="line danger"><v-icon name="error" x-small /> broken link</span>
				<span class="line warning"><v-icon name="warning" x-small /> required link missing</span>
				<span class="line info"><v-icon name="link_off" x-small /> not used anywhere</span>
			</p>
		</section>

		<section class="panel">
			<h3 class="type-label">Circular links</h3>
			<p v-if="cycles.cycles.length === 0" class="line success small"><v-icon name="check_circle" small /> No circular links.</p>
			<p v-for="(cycle, index) in cycles.cycles" :key="index" v-tooltip="cycleTechnical(cycle)" class="line warning">
				<v-icon name="sync" small />
				<span v-if="cycle.collections.length === 1">
					<button class="link" @click="emit('select', cycle.collections[0])">{{ collectionName(cycle.collections[0]) }}</button>
					links to itself ({{ cycle.hops[0].fields.map((field) => fieldName(cycle.collections[0], field)).join(', ') }})
				</span>
				<span v-else>
					Circular link:
					<template v-for="id in cycle.collections" :key="id">
						<button class="link" @click="emit('select', id)">{{ collectionName(id) }}</button> →
					</template>
					{{ collectionName(cycle.collections[0]) }}
				</span>
			</p>
			<p v-if="cycles.truncated" class="muted small">Only the first {{ cycles.cycles.length }} are shown.</p>
		</section>

		<section class="panel">
			<h3 class="type-label">Not connected</h3>
			<p v-if="isolated.length === 0" class="line success small">
				<v-icon name="check_circle" small /> Every collection is linked to at least one other.
			</p>
			<p v-else class="line info">
				<v-icon name="link_off" small />
				<span>
					{{ isolated.length }} collection{{ isolated.length === 1 ? " isn't" : "s aren't" }} connected to anything:
					<template v-for="(id, index) in isolated" :key="id">
						<button class="link" @click="emit('select', id)">{{ collectionName(id) }}</button>{{ index < isolated.length - 1 ? ', ' : '' }}
					</template>
				</span>
			</p>
		</section>
	</div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { filterGraph, findCycles } from '../../shared/graph.js';
import { countOf, singular } from '../../shared/wording.js';
import { useNames } from '../use-names.js';
import ItemList from './item-list.vue';

const ICONS = { danger: 'error', warning: 'warning', info: 'link_off', success: 'check_circle' };
const TONE_ORDER = ['danger', 'warning', 'info'];
const AUTO_LIMIT = 20;
const ITEM_LIMIT = 10;

const props = defineProps({
	graph: { type: Object, required: true },
});

const emit = defineEmits(['select', 'check']);

const api = useApi();
const { collectionName, fieldName } = useNames();
const results = reactive({});
const queued = ref([]);
const running = ref(false);

const userIds = computed(() => props.graph.collections.filter((node) => !node.system).map((node) => node.id));
const linked = computed(() => new Set(props.graph.edges.flatMap((edge) => [edge.source, edge.target])));
const isolated = computed(() => userIds.value.filter((id) => !linked.value.has(id)));
const targets = computed(() => userIds.value.filter((id) => linked.value.has(id)));
const cycles = computed(() => findCycles(filterGraph(props.graph, { includeSystem: false })));
const linkCount = computed(() => {
	const user = new Set(userIds.value);
	return props.graph.edges.filter((edge) => user.has(edge.source) || user.has(edge.target)).length;
});

const numbers = computed(() => [
	{ label: 'collections', value: userIds.value.length },
	{ label: 'links between them', value: linkCount.value },
	{ label: 'circular links', value: cycles.value.cycles.length, tone: cycles.value.cycles.length ? 'warning' : null },
]);

const remaining = computed(() => targets.value.filter((id) => !results[id]));
const doneCount = computed(() => queued.value.filter((id) => results[id]?.data || results[id]?.error).length);
const failures = computed(() => targets.value.filter((id) => results[id]?.error).map((id) => ({ collection: id, error: results[id].error })));

const findings = computed(() =>
	targets.value
		.flatMap((id) => (results[id]?.data ? findingsOf(results[id].data) : []))
		.sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone) || b.total - a.total),
);

const cleanCount = computed(() => {
	const withFindings = new Set(findings.value.map((finding) => finding.collection));
	return targets.value.filter((id) => results[id]?.data && !withFindings.has(id)).length;
});

function findingsOf(result) {
	const collection = result.collection;
	const name = collectionName(collection);
	const list = [];
	const plural = (total, one, many) => (total === 1 ? one : many);

	if (result.unreferenced.applicable && result.unreferenced.total > 0) {
		const { total, items } = result.unreferenced;
		list.push({ key: `${collection}:unused`, tone: 'info', collection, total, items, text: `${countOf(total, name)} ${plural(total, 'is', 'are')} not used by anything` });
	}

	for (const check of result.missingRequired.filter((entry) => entry.total > 0)) {
		list.push({
			key: `${collection}:required:${check.id}`,
			tone: 'warning',
			collection,
			total: check.total,
			items: check.items,
			text: `${countOf(check.total, name)} ${plural(check.total, 'has', 'have')} no ${fieldName(collection, check.field)} (required)`,
		});
	}

	for (const check of result.brokenReferences.filter((entry) => entry.total > 0)) {
		list.push({
			key: `${collection}:broken:${check.id}`,
			tone: 'danger',
			collection,
			total: check.total,
			items: check.items,
			text: `${countOf(check.total, name)} point${plural(check.total, 's', '')} to a ${singular(collectionName(check.target).toLowerCase())} that no longer exists`,
		});
	}

	return list;
}

function cycleTechnical(cycle) {
	return cycle.hops.map((hop) => `${hop.source}.${hop.fields.join('/')} → ${hop.target}`).join('\n');
}

async function scan(ids) {
	queued.value = [...queued.value, ...ids];
	running.value = true;

	for (const id of ids) {
		results[id] = { loading: true };
		try {
			const { data } = await api.get(`/content-dependency-graph/orphans/${encodeURIComponent(id)}`, { params: { limit: ITEM_LIMIT } });
			results[id] = { data };
		} catch (err) {
			results[id] = { error: err?.response?.data?.errors?.[0]?.message ?? err.message };
		}
	}

	running.value = false;
}

onMounted(() => scan(targets.value.slice(0, AUTO_LIMIT)));
</script>

<style scoped>
.health-check {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.numbers {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: 12px;
}

.number,
.panel {
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
}

.number {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 12px 16px;
}

.number strong { font-size: 24px; }
.number strong.warning { color: var(--theme--warning); }

.panel {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 8px;
	padding: 20px;
}

header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
}

h3 { margin: 0; }
p { margin: 0; }

.progress {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.finding { width: 100%; }

.line {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

summary.line { cursor: pointer; list-style: none; }
summary.line::-webkit-details-marker { display: none; }

.danger .v-icon { color: var(--theme--danger); }
.warning .v-icon { color: var(--theme--warning); }
.info .v-icon { color: var(--theme--primary); }
.success .v-icon { color: var(--theme--success); }

.indent { margin-left: 26px; }

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	margin-top: 4px;
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
