<template>
	<private-view title="Permission Simulator">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="security" />
			</v-button>
		</template>

		<template #actions>
			<template v-if="isAdmin && result">
				<v-menu show-arrow placement="bottom-end">
					<template #activator="{ toggle }">
						<v-button v-tooltip.bottom="'Export'" rounded icon secondary @click="toggle">
							<v-icon name="download" />
						</v-button>
					</template>
					<v-list>
						<v-list-item clickable @click="exportReport('json')">
							<v-list-item-content>Export as JSON</v-list-item-content>
						</v-list-item>
						<v-list-item clickable @click="exportReport('csv')">
							<v-list-item-content>Export as CSV</v-list-item-content>
						</v-list-item>
					</v-list>
				</v-menu>
			</template>
		</template>

		<template v-if="isAdmin" #navigation>
			<div class="nav-activity">
				<label class="field-label">View access as</label>
				<v-select
					v-model="selection"
					:items="principalItems"
					:disabled="!principalItems.length"
					placeholder="Pick a role or user"
				/>

				<template v-if="result">
					<label class="field-label">Compare with</label>
					<v-select
						v-model="compareWith"
						:items="compareItems"
						:disabled="selectedMode !== 'role' || comparing"
						show-deselect
						placeholder="Another role"
					/>
					<p v-if="selectedMode !== 'role'" class="hint">Comparing works with roles. Pick a role above.</p>

					<div class="legend">
						<span v-for="(info, level) in ACCESS" :key="level" class="legend-item">
							<v-icon :name="info.icon" :class="level" small />
							{{ info.label }}
						</span>
					</div>
				</template>
			</div>
		</template>

		<div class="permission-simulator">
			<v-notice v-if="!isAdmin" type="danger" class="padded">Only administrators can use Permission Simulator.</v-notice>

			<template v-else>
				<v-notice v-if="error" type="danger" class="padded">
					Couldn't load permissions: {{ error }}
					<v-button class="retry" x-small secondary @click="retry">Try again</v-button>
				</v-notice>

				<v-info v-else-if="metaLoaded && !principalItems.length" class="empty" icon="security" title="No roles or users" center>
					Create a role in Settings → Roles first.
				</v-info>

				<v-info v-else-if="metaLoaded && !selection && !loading && !starting" class="empty" icon="security" title="Pick a role or user" center>
					Choose who to check in the sidebar to see what they can do.
				</v-info>

				<div v-else-if="!result" class="state padded">
					<v-progress-circular indeterminate />
					<span>Loading permissions…</span>
				</div>

				<template v-else>
					<header class="run-bar">
						<div class="run-title">
							<template v-if="compareResult">
								<strong>{{ leftName }}</strong>
								<span class="muted">compared with</span>
								<strong>{{ rightName }}</strong>
								<span class="pill changed">{{ diffCount }} {{ diffCount === 1 ? 'difference' : 'differences' }}</span>
							</template>
							<template v-else>
								<strong>{{ result.principal.label }}</strong>
								<span class="muted">{{ principalNote || 'Click a collection to see why.' }}</span>
							</template>
						</div>
					</header>

					<v-info
						v-if="!rows.length"
						class="empty"
						icon="security"
						:title="compareResult ? 'No differences' : 'No collections found'"
						center
					>
						<template v-if="compareResult">{{ leftName }} and {{ rightName }} have exactly the same access.</template>
						<template v-else>This project has no collections yet.</template>
					</v-info>

					<div v-else class="table-wrap" :class="{ busy: loading || comparing }">
						<table>
							<thead>
								<tr>
									<th>Collection</th>
									<th v-for="action in ACTIONS" :key="action">{{ ACTION_LABELS[action] }}</th>
								</tr>
							</thead>
							<tbody v-for="section in sections" :key="section.key">
								<tr class="group">
									<td :colspan="ACTIONS.length + 1">{{ section.label }}</td>
								</tr>
								<tr
									v-for="row in section.rows"
									:key="row.collection"
									tabindex="0"
									@click="openDrawer(row.collection)"
									@keydown.enter="openDrawer(row.collection)"
								>
									<td class="collection">
										<v-icon :name="row.icon" small />
										{{ row.label }}
									</td>
									<td v-for="action in ACTIONS" :key="action" :class="{ changed: row.diffs?.[action] }">
										<span v-if="row.diffs?.[action]" class="diff">
											{{ leftName }}:
											<v-icon :name="ACCESS[row.diffs[action].left].icon" :class="row.diffs[action].left" x-small />
											/ {{ rightName }}:
											<v-icon :name="ACCESS[row.diffs[action].right].icon" :class="row.diffs[action].right" x-small />
										</span>
										<v-icon
											v-else
											v-tooltip="ACCESS[row.cells[action]].label"
											:name="ACCESS[row.cells[action]].icon"
											:class="[row.cells[action], { faded: compareResult }]"
											small
										/>
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				</template>
			</template>
		</div>

		<v-drawer
			v-model="drawerOpen"
			:title="drawerCollection ? collectionLabel(drawerCollection) : ''"
			:subtitle="result ? `As ${result.principal.label}` : ''"
			icon="security"
			@cancel="drawerOpen = false"
		>
			<div class="drawer-content">
				<div v-if="detailLoading" class="state">
					<v-progress-circular indeterminate />
					<span>Working out the details…</span>
				</div>

				<v-notice v-else-if="detailError" type="danger">Couldn't load details: {{ detailError }}</v-notice>

				<template v-else-if="detail">
					<section v-for="item in explanations" :key="item.action" class="explain" :class="item.level">
						<v-icon :name="ACCESS[item.level].icon" :class="item.level" />
						<div>
							<p class="headline">
								<strong>{{ ACTION_LABELS[item.action] }}:</strong> {{ item.headline }}
							</p>
							<p v-for="line in item.lines" :key="line" class="muted">{{ line }}</p>
						</div>
					</section>

					<p v-for="warning in conflictLines" :key="warning" class="conflict">
						<v-icon name="warning" small />
						{{ warning }}
					</p>

					<section v-if="itemCheckAvailable" class="item-check">
						<h3>Check a specific item</h3>
						<v-select
							v-model="selectedItem"
							:items="itemOptions"
							:disabled="itemsLoading || !itemOptions.length"
							:placeholder="itemsLoading ? 'Loading items…' : itemOptions.length ? 'Pick an item' : 'No items yet'"
						/>
						<div v-if="itemLoading" class="state small">
							<v-progress-circular indeterminate small />
							<span>Checking…</span>
						</div>
						<p v-else-if="itemError" class="denied-text">Couldn't check this item: {{ itemError }}</p>
						<ul v-else-if="itemLines.length" class="item-lines">
							<li v-for="line in itemLines" :key="line.text">
								<v-icon :name="line.ok ? 'check_circle' : 'block'" :class="line.ok ? 'full' : 'denied'" small />
								{{ line.text }}
							</li>
						</ul>
					</section>

					<details class="technical">
						<summary>Technical details</summary>
						<pre>{{ technicalDetails }}</pre>
					</details>
				</template>
			</div>
		</v-drawer>
	</private-view>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import {
	formatCompareCsv,
	formatCompareJson,
	formatSimulateCsv,
	formatSimulateJson,
} from '../shared/reports.js';
import {
	ACTIONS,
	explainAction,
	explainConflicts,
	groupDiffsByCollection,
	humanize,
} from '../shared/plain-language.js';

const ACCESS = {
	full: { icon: 'check_circle', label: 'Full access' },
	partial: { icon: 'filter_alt', label: 'Some items only' },
	none: { icon: 'remove', label: 'No access' },
};

const ACTION_LABELS = { create: 'Create', read: 'Read', update: 'Update', delete: 'Delete' };
const ITEM_VERBS = { read: 'see', update: 'edit', delete: 'delete' };
const DISPLAY_FIELDS = ['title', 'name', 'label', 'email', 'slug', 'username', 'code'];

const api = useApi();
const { useUserStore, useCollectionsStore, useFieldsStore } = useStores();
const userStore = useUserStore();
const collectionsStore = useCollectionsStore();
const fieldsStore = useFieldsStore();

const isAdmin = computed(() => userStore.currentUser?.admin_access === true);

const users = ref([]);
const roles = ref([]);
const collections = ref([]);
const policyNames = ref(new Map());
const metaLoaded = ref(false);

const selection = ref(null);
const result = ref(null);
const loading = ref(false);
const error = ref(null);
let loadedKey = null;
let requestId = 0;

const compareResult = ref(null);
const comparing = ref(false);

const drawerOpen = ref(false);
const drawerCollection = ref(null);
const detail = ref(null);
const detailLoading = ref(false);
const detailError = ref(null);
const itemOptions = ref([]);
const itemsLoading = ref(false);
const selectedItem = ref(null);
const itemResult = ref(null);
const itemLoading = ref(false);
const itemError = ref(null);

const selectedMode = computed(() => selection.value?.split(':')[0] ?? null);

const principalItems = computed(() => {
	const roleItems = roles.value.map((role) => ({ text: `Role · ${role.name}`, value: `role:${role.id}` }));
	const userItems = users.value.map((user) => ({
		text: `User · ${user.email && user.name !== user.email ? `${user.name} (${user.email})` : user.name}`,
		value: `user:${user.id}`,
	}));
	return roleItems.length && userItems.length ? [...roleItems, { divider: true }, ...userItems] : [...roleItems, ...userItems];
});

const compareCandidates = computed(() => roles.value.filter((role) => `role:${role.id}` !== selection.value));
const compareItems = computed(() => compareCandidates.value.map((role) => ({ text: role.name, value: role.id })));
const compareWith = ref(null);
const starting = ref(true);

const principalNote = computed(() => {
	const accountability = result.value?.accountability;
	if (!accountability) return null;
	if (accountability.admin) return 'Has admin access — can do everything.';
	if (!accountability.app) return 'No app access — can only use the API.';
	return null;
});

const leftName = computed(() => compareResult.value?.left.principal.label ?? '');
const rightName = computed(() => compareResult.value?.right.principal.label ?? '');
const diffRows = computed(() => (compareResult.value ? groupDiffsByCollection(compareResult.value.accessDiffs) : null));
const sections = computed(() => {
	const own = rows.value.filter((row) => !row.collection.startsWith('directus_'));
	const system = rows.value.filter((row) => row.collection.startsWith('directus_'));
	return [
		{ key: 'own', label: 'Collections', rows: own },
		{ key: 'system', label: 'System collections', rows: system },
	].filter((section) => section.rows.length);
});
const diffCount = computed(() => rows.value.reduce((total, row) => total + Object.keys(row.diffs ?? {}).length, 0));

const rows = computed(() => {
	if (!result.value) return [];
	const access = result.value.collectionAccess ?? {};
	const admin = result.value.accountability.admin === true;
	const names = new Set([...collections.value, ...Object.keys(access)]);

	return [...names]
		.filter((name) => !diffRows.value || diffRows.value.has(name))
		.map((name) => ({
			collection: name,
			label: collectionLabel(name),
			icon: collectionsStore.getCollection(name)?.icon ?? 'database',
			cells: Object.fromEntries(ACTIONS.map((action) => [action, admin ? 'full' : level(access[name]?.[action]?.access)])),
			diffs: diffRows.value?.get(name) ?? null,
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
});

const explanations = computed(() => {
	if (!detail.value) return [];
	const collection = drawerCollection.value;
	const labelFor = (field, depth) => (depth === 0 ? fieldLabel(collection, field) : humanize(field));

	return ACTIONS.map((action) => {
		const merged = detail.value.mergedRules.find((rule) => rule.action === action);
		return {
			action,
			...explainAction({
				action,
				access: detail.value.collectionAccess[collection]?.[action],
				merged,
				totalFields: detail.value.fields.length,
				isAdmin: detail.value.accountability.admin === true,
				policyNames: (merged?.policyIds ?? []).map((id) => policyNames.value.get(id) ?? 'Unnamed policy'),
				labelFor,
			}),
		};
	});
});

const conflictLines = computed(() => explainConflicts(detail.value?.conflicts));

const technicalDetails = computed(() =>
	JSON.stringify(
		{
			access: detail.value?.collectionAccess[drawerCollection.value] ?? null,
			mergedRules: detail.value?.mergedRules ?? [],
			conflicts: detail.value?.conflicts ?? [],
		},
		null,
		2,
	),
);

const itemCheckAvailable = computed(() => {
	const collection = drawerCollection.value;
	if (!collection || collection.startsWith('directus_')) return false;
	return collectionsStore.getCollection(collection)?.meta?.singleton !== true;
});

const itemLines = computed(() =>
	(itemResult.value?.actions ?? [])
		.filter((entry) => entry.action in ITEM_VERBS)
		.map((entry) => ({
			ok: entry.itemAllowed === true,
			text: `${entry.itemAllowed ? 'Can' : 'Cannot'} ${ITEM_VERBS[entry.action]} this item`,
		})),
);

watch(compareWith, (roleId) => {
	if (roleId) startCompare(roleId);
	else exitCompare();
});

watch(selection, (key) => {
	compareWith.value = null;
	compareResult.value = null;
	drawerOpen.value = false;
	if (key && key !== loadedKey) loadSelection(key);
});

watch(selectedItem, (key) => {
	itemResult.value = null;
	itemError.value = null;
	if (key !== null && key !== undefined) checkItem(key);
});

onMounted(async () => {
	if (!isAdmin.value) return;
	loadPolicyNames();
	await loadMeta();
	if (!error.value) await autoSelect();
	starting.value = false;
});

async function loadMeta() {
	error.value = null;
	try {
		const { data } = await api.get('/permission-simulator/meta');
		users.value = data.users ?? [];
		roles.value = data.roles ?? [];
		collections.value = data.collections ?? [];
		metaLoaded.value = true;
	} catch (err) {
		error.value = extractError(err);
	}
}

async function loadPolicyNames() {
	try {
		const { data } = await api.get('/policies', { params: { fields: ['id', 'name'], limit: -1 } });
		policyNames.value = new Map((data.data ?? []).map((policy) => [String(policy.id), policy.name]));
	} catch {
		// Names are a nicety; the drawer falls back to "Unnamed policy".
	}
}

// Pick the first role that is not an admin, so the table shows something useful right away.
async function autoSelect() {
	const candidates = roles.value.slice(0, 5).map((role) => `role:${role.id}`);
	if (!candidates.length && users.value[0]) candidates.push(`user:${users.value[0].id}`);

	let fallback = null;
	try {
		for (const key of candidates) {
			const data = await simulate(key);
			fallback ??= { key, data };
			if (!data.accountability.admin) return apply(key, data);
		}
		if (fallback) apply(fallback.key, fallback.data);
	} catch (err) {
		error.value = extractError(err);
	}
}

function apply(key, data) {
	loadedKey = key;
	result.value = data;
	selection.value = key;
}

async function loadSelection(key) {
	const id = ++requestId;
	loading.value = true;
	error.value = null;
	try {
		const data = await simulate(key);
		if (id === requestId) apply(key, data);
	} catch (err) {
		if (id === requestId) error.value = extractError(err);
	} finally {
		if (id === requestId) loading.value = false;
	}
}

async function simulate(key, extra = {}) {
	const [mode, principalId] = key.split(':');
	const { data } = await api.post('/permission-simulator/simulate', { mode, principalId, ...extra });
	return data;
}

async function retry() {
	if (!metaLoaded.value) {
		await loadMeta();
		if (!error.value) await autoSelect();
	} else if (selection.value) {
		loadedKey = null;
		await loadSelection(selection.value);
	} else {
		await autoSelect();
	}
}

async function startCompare(roleId) {
	if (selectedMode.value !== 'role') return;
	comparing.value = true;
	error.value = null;
	try {
		const { data } = await api.post('/permission-simulator/compare', {
			leftRoleId: selection.value.split(':')[1],
			rightRoleId: roleId,
		});
		compareResult.value = data;
	} catch (err) {
		error.value = extractError(err);
	} finally {
		comparing.value = false;
	}
}

function exitCompare() {
	compareWith.value = null;
	compareResult.value = null;
}

async function openDrawer(collection) {
	drawerCollection.value = collection;
	drawerOpen.value = true;
	detail.value = null;
	detailError.value = null;
	selectedItem.value = null;
	itemResult.value = null;
	itemOptions.value = [];
	detailLoading.value = true;

	try {
		detail.value = await simulate(selection.value, { collection });
	} catch (err) {
		detailError.value = extractError(err);
	} finally {
		detailLoading.value = false;
	}

	if (itemCheckAvailable.value) loadItems(collection);
}

async function loadItems(collection) {
	const primaryKey = fieldsStore.getPrimaryKeyFieldForCollection(collection)?.field ?? 'id';
	const display = displayField(collection) ?? primaryKey;
	itemsLoading.value = true;

	try {
		const { data } = await api.get(`/items/${collection}`, {
			params: { limit: 100, fields: [...new Set([primaryKey, display])] },
		});
		if (drawerCollection.value !== collection) return;
		itemOptions.value = (data.data ?? []).map((item) => ({
			text: String(item[display] ?? item[primaryKey]),
			value: item[primaryKey],
		}));
	} catch {
		itemOptions.value = [];
	} finally {
		itemsLoading.value = false;
	}
}

async function checkItem(primaryKey) {
	const collection = drawerCollection.value;
	itemLoading.value = true;
	try {
		const data = await simulate(selection.value, { collection, primaryKey });
		if (drawerCollection.value === collection && selectedItem.value === primaryKey) itemResult.value = data;
	} catch (err) {
		itemError.value = extractError(err);
	} finally {
		itemLoading.value = false;
	}
}

function displayField(collection) {
	const fields = (fieldsStore.getFieldsForCollection(collection) ?? []).map((field) => field.field);
	const template = collectionsStore.getCollection(collection)?.meta?.display_template ?? '';
	const fromTemplate = [...template.matchAll(/{{\s*([\w]+)\s*}}/g)].map((match) => match[1]).find((field) => fields.includes(field));
	return fromTemplate ?? DISPLAY_FIELDS.find((field) => fields.includes(field)) ?? null;
}

function collectionLabel(collection) {
	return collectionsStore.getCollection(collection)?.name ?? humanize(collection);
}

function fieldLabel(collection, field) {
	return fieldsStore.getField(collection, field)?.name ?? humanize(field);
}

function level(access) {
	return access === 'full' || access === 'partial' ? access : 'none';
}

function exportReport(format) {
	const content = compareResult.value
		? format === 'json'
			? formatCompareJson(compareResult.value)
			: formatCompareCsv(compareResult.value)
		: format === 'json'
			? formatSimulateJson(result.value)
			: formatSimulateCsv(result.value);

	const stamp = new Date().toISOString().replaceAll(':', '-');
	const blob = new Blob([content], { type: `${format === 'json' ? 'application/json' : 'text/csv'};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `permission-${compareResult.value ? 'compare' : 'simulate'}-${stamp}.${format}`;
	anchor.click();
	URL.revokeObjectURL(url);
}

function extractError(err) {
	return err?.response?.data?.errors?.[0]?.message || err?.message || 'Request failed';
}
</script>

<style scoped>
.permission-simulator {
	display: flex;
	flex-direction: column;
	height: calc(100vh - 64px);
	min-height: 420px;
}

.padded {
	margin: var(--content-padding);
}

.empty {
	flex: 1;
}

.header-icon {
	margin-right: 8px;
}

.nav-activity {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 12px 20px;
}

.field-label {
	margin-top: 8px;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.field-label:first-child {
	margin-top: 0;
}

tr.group td {
	padding: 8px var(--content-padding);
	background: var(--theme--background-subdued);
	color: var(--theme--foreground-subdued);
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.05em;
	text-align: left;
	text-transform: uppercase;
}

tbody tr.group {
	cursor: default;
}

tbody tr.group:hover {
	background: none;
}

.hint {
	margin: 0;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

.legend {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-top: 12px;
	padding-top: 12px;
	border-top: var(--theme--border-width) solid var(--theme--border-color-subdued);
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

.legend-item {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}

.run-bar {
	display: flex;
	align-items: center;
	min-height: 64px;
	padding: 12px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.run-title {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
}

.pill {
	padding: 0 8px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 600;
	line-height: 18px;
}

.pill.changed {
	background: color-mix(in srgb, var(--theme--warning) 16%, transparent);
	color: var(--theme--warning);
}

.retry {
	margin-left: 12px;
}

.state {
	display: flex;
	align-items: center;
	gap: 12px;
	color: var(--theme--foreground-subdued);
}

.state.small {
	margin: 12px 0;
}

.muted {
	color: var(--theme--foreground-subdued);
}

.table-wrap {
	flex: 1;
	min-height: 0;
	overflow: auto;
	transition: opacity 0.2s;
}

.table-wrap.busy {
	opacity: 0.5;
}

table {
	width: 100%;
	border-collapse: collapse;
}

th,
td {
	padding: 12px 16px;
	text-align: center;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

th:first-child,
td:first-child {
	padding-left: var(--content-padding);
	text-align: left;
}

th {
	position: sticky;
	top: 0;
	z-index: 2;
	background: var(--theme--background);
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
}

tbody tr {
	cursor: pointer;
}

tbody tr:hover,
tbody tr:focus-visible {
	background: var(--theme--background-subdued);
	outline: none;
}

.collection {
	display: flex;
	align-items: center;
	gap: 10px;
	font-weight: 500;
}

td.changed {
	background: color-mix(in srgb, var(--theme--warning) 12%, transparent);
}

.diff {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 12px;
	white-space: nowrap;
}

.v-icon.full {
	color: var(--theme--success);
}

.v-icon.partial {
	color: var(--theme--warning);
}

.v-icon.none {
	color: var(--theme--foreground-subdued);
}

.v-icon.denied {
	color: var(--theme--danger);
}

.v-icon.faded {
	opacity: 0.35;
}

.drawer-content {
	padding: var(--content-padding);
	padding-top: 0;
	padding-bottom: var(--content-padding-bottom);
}

.explain {
	display: flex;
	gap: 12px;
	padding: 14px 0;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.explain p {
	margin: 0 0 4px;
}

.explain .headline {
	margin-bottom: 6px;
}

.conflict {
	display: flex;
	gap: 8px;
	align-items: flex-start;
	margin: 12px 0 0;
	color: var(--theme--warning);
}

.item-check {
	margin-top: 28px;
}

.item-check h3 {
	margin: 0 0 8px;
	font-size: 15px;
	font-weight: 600;
}

.denied-text {
	margin: 12px 0 0;
	color: var(--theme--danger);
}

.item-lines {
	list-style: none;
	margin: 12px 0 0;
	padding: 0;
}

.item-lines li {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 6px;
}

.technical {
	margin-top: 28px;
}

.technical summary {
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	font-size: 13px;
}

pre {
	margin-top: 8px;
	padding: 12px;
	overflow-x: auto;
	font-family: var(--theme--fonts--monospace--font-family), monospace;
	font-size: 12px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
}
</style>
