<template>
	<private-view title="Activity Cleanup">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="cleaning_services" />
			</v-button>
		</template>

		<template #actions>
			<template v-if="isAdmin">
				<v-button v-tooltip.bottom="'Refresh'" rounded icon secondary :loading="loading" @click="loadOverview">
					<v-icon name="refresh" />
				</v-button>
				<v-menu v-if="overview" show-arrow placement="bottom-end">
					<template #activator="{ toggle }">
						<v-button v-tooltip.bottom="'Export'" rounded icon secondary @click="toggle">
							<v-icon name="download" />
						</v-button>
					</template>
					<v-list>
						<v-list-item clickable @click="exportReport('csv')">
							<v-list-item-content>Export as CSV</v-list-item-content>
						</v-list-item>
						<v-list-item clickable @click="exportReport('json')">
							<v-list-item-content>Export as JSON</v-list-item-content>
						</v-list-item>
					</v-list>
				</v-menu>
			</template>
		</template>

		<template v-if="isAdmin" #navigation>
			<div class="nav-activity">
				<template v-if="overview">
					<label class="field-label">Automatic cleanup</label>
					<div>
						<span class="pill" :class="status.on ? 'on' : 'off'">{{ status.cleanup }}</span>
					</div>
					<p class="hint">{{ status.usage }}</p>
					<p v-if="tip" class="hint">{{ tip }}</p>
					<v-button class="nav-button" secondary small full-width @click="settingsOpen = true">
						{{ status.on ? 'Retention settings' : 'How to turn it on' }}
					</v-button>
				</template>
				<p v-else class="hint">{{ loading ? 'Counting history records…' : '' }}</p>
			</div>
		</template>

		<div class="cleanup-manager">
			<v-notice v-if="!isAdmin" type="danger" class="padded">Only administrators can use Activity Cleanup.</v-notice>

			<div v-else-if="!overview && loading" class="state padded">
				<v-progress-circular indeterminate />
				<span>Counting history records…</span>
			</div>

			<v-notice v-else-if="!overview && error" type="danger" class="padded">
				Couldn't load history: {{ error }} Try the refresh button.
			</v-notice>

			<template v-else-if="overview">
				<header class="run-bar">
					<div class="run-title">
						<strong>History by collection</strong>
						<span class="pill" :class="status.on ? 'on' : 'off'">Cleanup {{ status.on ? 'on' : 'off' }}</span>
						<span class="muted">{{ collections.length }} {{ collections.length === 1 ? 'collection' : 'collections' }}</span>
					</div>
				</header>

				<p v-if="error" class="banner failure">{{ error }}</p>
				<p v-if="result" class="banner success">
					<v-icon name="check_circle" small />
					{{ result }}
				</p>

				<v-info v-if="!collections.length" class="empty" icon="cleaning_services" title="Nothing to clean up" center>
					No history has been recorded yet.
				</v-info>

				<div v-else class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Collection</th>
								<th class="num">History records</th>
								<th>Oldest</th>
								<th />
							</tr>
						</thead>
						<tbody>
							<tr v-for="item in collections" :key="item.collection">
								<td class="name">
									{{ nameOf(item.collection) }}
									<span v-if="!item.exists" class="pill off">Deleted collection</span>
								</td>
								<td class="num" :title="`${formatCount(item.activity)} activity · ${formatCount(item.revisions)} revisions`">
									{{ formatCount(historyRecords(item)) }}
								</td>
								<td class="muted" :title="item.oldest ? new Date(item.oldest).toLocaleString() : ''">{{ timeAgo(item.oldest) }}</td>
								<td class="right">
									<v-button v-if="canClean(item)" x-small secondary @click="openCleanup(item)">Clean up</v-button>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</template>
		</div>

		<v-dialog v-model="settingsOpen" @esc="settingsOpen = false">
			<v-card v-if="overview">
				<v-card-title>Retention settings</v-card-title>
				<v-card-text>
					<template v-if="!status.on">
						<p>Add these lines to your Directus environment (for example <code>.env</code>) and restart Directus. It then deletes older history automatically every night.</p>
						<pre class="env">{{ enableLines }}</pre>
					</template>
					<p v-else class="muted">Read from the server environment. Change them there.</p>
					<table class="settings-table">
						<tbody>
							<tr v-for="row in retentionRows" :key="row.key">
								<td class="mono">{{ row.key }}</td>
								<td class="mono">
									{{ row.value }}
									<span v-if="row.isDefault" class="muted">(default)</span>
								</td>
								<td class="muted">{{ row.effect }}</td>
							</tr>
						</tbody>
					</table>
					<ul v-if="retention.notes.length" class="notes muted">
						<li v-for="note in retention.notes" :key="note">{{ note }}</li>
					</ul>
				</v-card-text>
				<v-card-actions>
					<v-button @click="settingsOpen = false">Close</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="dialogOpen" :persistent="purging" @esc="!purging && (dialogOpen = false)">
			<v-card>
				<v-card-title>Delete history for {{ target ? nameOf(target.collection) : '' }}</v-card-title>
				<v-card-text>
					<v-select v-model="age" :items="AGE_OPTIONS" item-text="text" item-value="value" :disabled="purging" />
					<p class="dialog-line">
						<template v-if="previewing">Counting records…</template>
						<span v-else-if="previewError" class="danger-text">{{ previewError }}</span>
						<template v-else-if="preview">
							<template v-if="toDelete">This will delete <strong>{{ formatCount(toDelete) }}</strong> {{ toDelete === 1 ? 'record' : 'records' }}. This can't be undone.</template>
							<template v-else>Nothing to delete for this period.</template>
						</template>
					</p>
					<p v-if="preview?.preview.protectedActivity" class="muted small">
						{{ formatCount(preview.preview.protectedActivity) }} records linked to content versions are kept.
					</p>
				</v-card-text>
				<v-card-actions>
					<v-button secondary :disabled="purging" @click="dialogOpen = false">Cancel</v-button>
					<v-button kind="danger" :disabled="!toDelete || previewing" :loading="purging" @click="runPurge">
						Delete {{ formatCount(toDelete) }} {{ toDelete === 1 ? 'record' : 'records' }}
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import { formatCount, formatOverviewCsv, formatOverviewJson } from '../shared/reports.js';
import { AGE_OPTIONS, cutoffFor, enableEnv, historyRecords, statusLine, timeAgo, topTip } from '../shared/summary.js';

const PURGE_URL = '/activity-cleanup-manager/purge';

const api = useApi();
const { useUserStore, useCollectionsStore } = useStores();
const userStore = useUserStore();
const collectionsStore = useCollectionsStore();
const isAdmin = computed(() => userStore.currentUser?.admin_access === true);

const overview = ref(null);
const loading = ref(false);
const error = ref(null);
const result = ref(null);

const settingsOpen = ref(false);
const dialogOpen = ref(false);
const target = ref(null);
const age = ref('90d');
const cutoff = ref(null);
const preview = ref(null);
const previewing = ref(false);
const previewError = ref(null);
const purging = ref(false);
let previewToken = 0;

const insights = computed(() => overview.value?.insights);
const retention = computed(() => overview.value?.retention);
const status = computed(() => statusLine(overview.value));
const tip = computed(() => topTip(insights.value, nameOf));
const collections = computed(() => insights.value?.byCollection.filter((item) => historyRecords(item) > 0) ?? []);
const enableLines = computed(() =>
	Object.entries(enableEnv(overview.value))
		.map(([key, value]) => `${key}=${value}`)
		.join('\n'),
);
const toDelete = computed(() => (preview.value ? historyRecords(preview.value.preview) : 0));

const retentionRows = computed(() => {
	const r = retention.value;
	const effects = {
		RETENTION_ENABLED: r.enabled ? 'Enabled' : 'Nothing is deleted automatically',
		RETENTION_SCHEDULE: r.scheduleValid ? 'When the cleanup job runs (cron)' : 'Invalid cron expression',
		RETENTION_BATCH: 'Rows deleted per statement',
		ACTIVITY_RETENTION: r.effective.activity ? `Activity (except flow runs) kept ${r.effective.activity}` : 'Activity never expires',
		REVISIONS_RETENTION: r.effective.revisions
			? `Revisions effectively kept ${r.effective.revisions}${r.tasks.revisions ? '' : ' (removed with their activity)'}`
			: 'Revisions never expire',
		FLOW_LOGS_RETENTION: r.effective.flowLogs ? `Flow run logs kept ${r.effective.flowLogs}` : 'Flow logs never expire',
	};
	return Object.keys(r.values).map((key) => ({ key, value: String(r.values[key]), isDefault: r.defaults[key], effect: effects[key] }));
});

watch(age, () => {
	if (dialogOpen.value) loadPreview();
});

onMounted(() => {
	if (isAdmin.value) loadOverview();
});

async function loadOverview() {
	loading.value = true;
	error.value = null;

	try {
		const { data } = await api.get('/activity-cleanup-manager/overview');
		overview.value = data;
	} catch (err) {
		error.value = readError(err);
	} finally {
		loading.value = false;
	}
}

function canClean(item) {
	return item.activity > 0 && item.collection !== '(none)';
}

function openCleanup(item) {
	target.value = item;
	result.value = null;
	dialogOpen.value = true;
	if (age.value === '90d') loadPreview();
	else age.value = '90d';
}

// Dry run for the chosen period. The cut-off is fixed here and reused for the real delete.
async function loadPreview() {
	const token = ++previewToken;
	const olderThan = cutoffFor(age.value);
	previewing.value = true;
	previewError.value = null;
	preview.value = null;

	try {
		const { data } = await api.post(PURGE_URL, { collection: target.value.collection, olderThan, dryRun: true });
		if (token !== previewToken) return;
		preview.value = data;
		cutoff.value = olderThan;
	} catch (err) {
		if (token === previewToken) previewError.value = readError(err);
	} finally {
		if (token === previewToken) previewing.value = false;
	}
}

async function runPurge() {
	const collection = target.value.collection;
	purging.value = true;
	previewError.value = null;

	try {
		const { data } = await api.post(PURGE_URL, { collection, olderThan: cutoff.value, dryRun: false, confirm: collection });
		result.value = `Deleted ${formatCount(historyRecords(data.deleted))} history records from ${nameOf(collection)}.`;
		dialogOpen.value = false;
		await loadOverview();
	} catch (err) {
		previewError.value = readError(err);
	} finally {
		purging.value = false;
	}
}

function nameOf(collection) {
	const name = collectionsStore.getCollection(collection)?.name;
	if (name) return name;
	if (collection === '(none)') return 'No collection';
	return collection
		.replace(/^directus_/, '')
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

function readError(err) {
	return err?.response?.data?.errors?.[0]?.message ?? err.message;
}

function exportReport(format) {
	const content = format === 'json' ? formatOverviewJson(overview.value) : formatOverviewCsv(overview.value);
	const blob = new Blob([content], { type: `${format === 'json' ? 'application/json' : 'text/csv'};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `activity-cleanup-${new Date().toISOString().replaceAll(':', '-')}.${format}`;
	anchor.click();
	URL.revokeObjectURL(url);
}
</script>
<style scoped>
.cleanup-manager {
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
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.hint {
	margin: 0;
	color: var(--theme--foreground-subdued);
	font-size: 13px;
}

.nav-button {
	margin-top: 8px;
}

.state {
	display: flex;
	align-items: center;
	gap: 12px;
	color: var(--theme--foreground-subdued);
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
	display: inline-block;
	padding: 0 8px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 600;
	line-height: 18px;
	background: color-mix(in srgb, var(--pill, var(--theme--foreground-subdued)) 16%, transparent);
	color: var(--pill, var(--theme--foreground-subdued));
}

.pill.on {
	--pill: var(--theme--success);
}

.pill.off {
	--pill: var(--theme--warning);
}

.banner {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	padding: 10px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
	font-size: 14px;
}

.banner.success {
	background: color-mix(in srgb, var(--theme--success) 10%, transparent);
	color: var(--theme--success);
}

.banner.failure {
	background: color-mix(in srgb, var(--theme--danger) 10%, transparent);
	color: var(--theme--danger);
}

.table-wrap {
	flex: 1;
	min-height: 0;
	overflow: auto;
}

table {
	width: 100%;
	border-collapse: collapse;
}

th,
td {
	padding: 12px 16px;
	text-align: left;
	vertical-align: middle;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

th:first-child,
td:first-child {
	padding-left: var(--content-padding);
}

th:last-child,
td:last-child {
	padding-right: var(--content-padding);
}

th {
	position: sticky;
	top: 0;
	z-index: 2;
	background: var(--theme--background);
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

tbody tr:hover {
	background: var(--theme--background-subdued);
}

.name {
	font-weight: 500;
}

.name .pill {
	margin-left: 8px;
}

.num {
	text-align: right;
	white-space: nowrap;
}

.right {
	text-align: right;
}

.env {
	margin: 12px 0;
	padding: 8px 12px;
	border-radius: var(--theme--border-radius);
	background: var(--theme--background-subdued);
	font-family: var(--theme--fonts--monospace--font-family), monospace;
	white-space: pre-wrap;
}

.settings-table {
	width: 100%;
	margin-top: 12px;
	border-collapse: collapse;
}

.settings-table td {
	padding: 6px 8px 6px 0;
	border-bottom: none;
	font-size: 13px;
}

.notes {
	margin: 12px 0 0;
	padding-left: 20px;
	font-size: 13px;
}

.dialog-line {
	margin: 16px 0 8px;
}

.danger-text { color: var(--theme--danger); }
.muted { color: var(--theme--foreground-subdued); }
.small { font-size: 13px; }
.mono { font-family: var(--theme--fonts--monospace--font-family), monospace; }
</style>
