<template>
	<private-view title="Media Usage Analyzer">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="perm_media" />
			</v-button>
		</template>

		<template #actions>
			<template v-if="isAdmin">
				<v-menu v-if="report" show-arrow placement="bottom-end">
					<template #activator="{ toggle }">
						<v-button v-tooltip.bottom="'Export'" rounded icon secondary @click="toggle">
							<v-icon name="download" />
						</v-button>
					</template>
					<v-list>
						<v-list-item clickable @click="exportReport('csv')">
							<v-list-item-icon><v-icon name="table_view" /></v-list-item-icon>
							<v-list-item-content>Export as CSV</v-list-item-content>
						</v-list-item>
						<v-list-item clickable @click="exportReport('json')">
							<v-list-item-icon><v-icon name="data_object" /></v-list-item-icon>
							<v-list-item-content>Export as JSON</v-list-item-content>
						</v-list-item>
					</v-list>
				</v-menu>
				<v-button v-tooltip.bottom="'Scan again'" rounded icon secondary :loading="loading" @click="runScan">
					<v-icon name="refresh" />
				</v-button>
			</template>
		</template>

		<template v-if="isAdmin" #navigation>
			<div class="nav-activity">
				<label class="field-label">Reports</label>
				<nav class="views">
					<button
						type="button"
						class="view"
						:class="{ active: active === 'overview' }"
						:disabled="!report"
						@click="active = 'overview'"
					>
						<v-icon name="dashboard" small />
						<span class="view-label">Overview</span>
					</button>
					<button
						v-for="card in cards"
						:key="card.id"
						type="button"
						class="view"
						:class="[card.tone, { active: active === card.id }]"
						:disabled="!report"
						@click="active = card.id"
					>
						<v-icon :name="card.icon" small />
						<span class="view-label">{{ card.label }}</span>
						<span v-if="report" class="pill" :class="card.tone">{{ card.pill }}</span>
						<span v-if="report && focus === card.id" v-tooltip="'Most worth a look'" class="dot" />
					</button>
				</nav>

				<label class="field-label">Scan</label>
				<v-checkbox v-model="scanContent" label="Also check links inside text fields" />
				<p class="hint">Slower. Applies the next time you scan again.</p>

				<p v-if="report" class="hint">
					Scanned {{ timeAgo(report.generatedAt) }}{{ report.summary.contentScanned ? ', including text fields' : '' }}.
				</p>
				<p v-if="report?.warnings.length" class="hint warning-text" :title="report.warnings.join('\n')">
					Some fields couldn't be checked, so results may be incomplete.
				</p>
			</div>
		</template>

		<div class="media-usage-analyzer">
			<v-notice v-if="!isAdmin" type="danger" class="padded">Only administrators can use Media Usage Analyzer.</v-notice>

			<div v-else-if="!report && loading" class="state">
				<v-progress-circular indeterminate />
				<span>Scanning your files… this can take a moment on large libraries.</span>
			</div>

			<v-notice v-else-if="!report && error" type="danger" class="padded">Couldn't scan your files: {{ error }} Try "Scan again".</v-notice>

			<template v-else-if="report">
				<header class="run-bar">
					<div class="run-title">
						<strong>{{ activeCard.title }}</strong>
						<span class="pill">{{ activeCard.value }}</span>
						<span class="pill quiet">{{ activeCard.detail }}</span>
					</div>
					<p class="muted run-hint">{{ activeHint }}</p>
				</header>

				<v-notice v-if="error" type="danger" class="padded">{{ error }}</v-notice>

				<div class="content">
					<section v-if="active === 'overview'" class="cards">
						<button
							v-for="card in cards"
							:key="card.id"
							type="button"
							class="card"
							:class="[card.tone, { focus: focus === card.id }]"
							@click="active = card.id"
						>
							<span class="card-label">
								<v-icon :name="card.icon" small />
								{{ card.label }}
								<span v-if="focus === card.id" class="pill">Start here</span>
							</span>
							<span class="card-value">{{ card.value }}</span>
							<span class="muted small">{{ card.detail }}</span>
						</button>
					</section>

					<template v-else-if="active === 'unused'">
						<v-notice v-if="deleteResult" :type="deleteResult.tone" class="padded">{{ deleteResult.text }}</v-notice>
						<template v-if="report.unusedFiles.length">
							<div class="toolbar">
								<v-checkbox
									:model-value="allSelected"
									:indeterminate="selected.size > 0 && !allSelected"
									label="Select all"
									@update:model-value="selectAll"
								/>
								<span class="muted small">{{ selected.size ? `${filesLabel(selected.size, selectedBytes)} selected` : '' }}</span>
								<v-button kind="danger" small :disabled="selected.size === 0" @click="deleteOpen = true">
									<v-icon name="delete" left small />
									Delete selected
								</v-button>
							</div>
							<file-list :files="report.unusedFiles" selectable :selected="selected" @toggle="toggle" />
							<p v-if="report.unusedTruncated" class="muted small more">
								Showing the {{ formatNumber(report.unusedFiles.length) }} largest. Delete some and scan again to see the rest.
							</p>
						</template>
						<v-info v-else class="empty" icon="check_circle" title="Every file is in use" center>
							Nothing to clean up.
						</v-info>
					</template>

					<template v-else-if="active === 'duplicates'">
						<template v-if="report.duplicates.groups.length">
							<article v-for="group in report.duplicates.groups" :key="group.key" class="group">
								<h3 class="group-title">
									{{ group.filename }}
									<span class="muted small">{{ group.count }} copies · {{ formatBytes(group.wastedBytes) }} could be freed</span>
								</h3>
								<file-list :files="group.files" :detail="usedLabel" />
							</article>
						</template>
						<v-info v-else class="empty" icon="content_copy" title="No duplicates" center>
							No duplicate uploads found.
						</v-info>
					</template>

					<template v-else-if="active === 'broken'">
						<ul v-if="report.broken.length" class="rows">
							<li v-for="entry in report.broken" :key="`${entry.source}:${entry.fileId}`" class="row" :title="`Missing file: ${entry.fileId}`">
								<v-icon name="link_off" class="danger-text" />
								<span class="name">
									<span>{{ whereLabel(entry) }}</span>
									<span class="muted small">
										{{ formatNumber(entry.count) }} {{ entry.count === 1 ? 'item points' : 'items point' }} to a missing file
									</span>
								</span>
								<router-link v-if="!entry.usageCollection.startsWith('directus_')" class="open" :to="`/content/${entry.usageCollection}`">
									Open
								</router-link>
							</li>
						</ul>
						<v-info v-else class="empty" icon="link" title="No broken links" center>
							Every file reference works.
						</v-info>
					</template>

					<template v-else-if="active === 'large'">
						<file-list v-if="report.images.large.length" :files="report.images.large" :detail="imageDetail" />
						<v-info v-else class="empty" icon="photo_size_select_large" title="No large images" center>
							Nothing is over 4000 px or 10 MB.
						</v-info>
					</template>

					<template v-else>
						<ul v-if="kinds.length" class="bars">
							<li v-for="row in kinds" :key="row.label" class="bar-row">
								<span>{{ row.label }}</span>
								<span class="bar-track"><span class="bar" :style="{ width: share(row.bytes) }" /></span>
								<span class="muted small">{{ formatBytes(row.bytes) }} · {{ formatNumber(row.files) }} files</span>
							</li>
						</ul>
						<h3 v-if="report.largestFiles.length" class="section-title">Largest files</h3>
						<file-list v-if="report.largestFiles.length" :files="report.largestFiles" :detail="usedLabel" />
						<v-info v-else class="empty" icon="cloud" title="No files yet" center>
							Uploaded files will show up here.
						</v-info>
					</template>
				</div>
			</template>
		</div>

		<v-dialog v-model="deleteOpen" :persistent="deleting" @esc="!deleting && (deleteOpen = false)">
			<v-card>
				<v-card-title>Delete {{ filesLabel(selected.size, selectedBytes) }}?</v-card-title>
				<v-card-text>
					This can't be undone. Files that are in use by now are skipped automatically.
					Links from outside Directus (other websites, custom code) can't be detected.
				</v-card-text>
				<v-card-actions>
					<v-button secondary :disabled="deleting" @click="deleteOpen = false">Cancel</v-button>
					<v-button kind="danger" :loading="deleting" @click="confirmDelete">
						Delete {{ formatNumber(selected.size) }} {{ selected.size === 1 ? 'file' : 'files' }}
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import FileList from './components/file-list.vue';
import { formatBytes, formatNumber, timeAgo } from '../shared/format.js';
import { deletionResultText, filesLabel, focusCard, storageByKind } from '../shared/overview.js';
import { formatReportCsv, formatReportJson } from '../shared/reports.js';

const DELETE_URL = '/media-usage-analyzer/delete';

const api = useApi();
const { useUserStore, useCollectionsStore, useFieldsStore } = useStores();
const userStore = useUserStore();
const collectionsStore = useCollectionsStore();
const fieldsStore = useFieldsStore();
const isAdmin = computed(() => userStore.currentUser?.admin_access === true);

const report = ref(null);
const loading = ref(false);
const error = ref(null);
const scanContent = ref(false);
const active = ref('overview');
const selected = ref(new Set());
const deleteOpen = ref(false);
const deleting = ref(false);
const deleteResult = ref(null);

const summary = computed(() => report.value?.summary ?? {});
const focus = computed(() => (report.value ? focusCard(summary.value) : null));
const unusedIds = computed(() => new Set(report.value?.unusedFiles.map((file) => file.id) ?? []));
const kinds = computed(() => storageByKind(report.value?.storage.byCategory));

const cards = computed(() => {
	const s = summary.value;
	return [
		{ id: 'storage', icon: 'cloud', label: 'Storage', title: 'Storage used', value: formatBytes(s.totalBytes), pill: formatBytes(s.totalBytes), detail: `in ${formatNumber(s.files)} files` },
		{ id: 'unused', icon: 'delete_sweep', label: 'Unused files', title: 'Unused files', value: formatNumber(s.unusedFiles), pill: formatNumber(s.unusedFiles), detail: formatBytes(s.unusedBytes), tone: s.unusedFiles ? 'warning' : 'success' },
		{ id: 'duplicates', icon: 'content_copy', label: 'Duplicates', title: 'Duplicate uploads', value: `${formatNumber(s.duplicateGroups)} ${s.duplicateGroups === 1 ? 'group' : 'groups'}`, pill: formatNumber(s.duplicateGroups), detail: `${formatBytes(s.duplicateWastedBytes)} could be freed`, tone: s.duplicateGroups ? 'warning' : 'success' },
		{ id: 'broken', icon: 'link_off', label: 'Broken links', title: 'Broken links', value: formatNumber(s.brokenReferences), pill: formatNumber(s.brokenReferences), detail: s.brokenReferences ? 'point to deleted files' : 'all links work', tone: s.brokenReferences ? 'danger' : 'success' },
		{ id: 'large', icon: 'photo_size_select_large', label: 'Large images', title: 'Large images', value: formatNumber(s.largeImages), pill: formatNumber(s.largeImages), detail: s.largeImages ? formatBytes(s.largeImagesBytes) : 'none over 4000 px or 10 MB', tone: s.largeImages ? 'warning' : 'success' },
	];
});

const activeCard = computed(() =>
	active.value === 'overview'
		? { id: 'overview', title: 'Overview', value: `${formatNumber(summary.value.files)} ${summary.value.files === 1 ? 'file' : 'files'}`, detail: formatBytes(summary.value.totalBytes) }
		: cards.value.find((card) => card.id === active.value),
);
const activeHint = computed(() => {
	if (!report.value) return '';
	switch (active.value) {
		case 'overview':
			return 'Pick a card to see the files behind it.';
		case 'unused':
			return `Not used in any file field${report.value.summary.contentScanned ? ' or text field' : ''}. Each file is checked again right before it is deleted.`;
		case 'duplicates':
			return `${report.value.duplicates.heuristic === 'checksum' ? 'Identical content.' : 'Same name, size and type.'} Point items at one copy; the others then show up as unused.`;
		case 'broken':
			return 'Fields that point to deleted files. Open the items and pick a new file or clear the field.';
		case 'large':
			return 'Wider or taller than 4000 px, or over 10 MB. Smaller versions load faster.';
		default:
			return 'Where your storage goes.';
	}
});

const selectedBytes = computed(() =>
	(report.value?.unusedFiles ?? []).filter((file) => selected.value.has(file.id)).reduce((total, file) => total + file.filesize, 0),
);
const allSelected = computed(() => selected.value.size > 0 && selected.value.size === report.value?.unusedFiles.length);

onMounted(() => {
	if (isAdmin.value) runScan();
});

async function runScan() {
	loading.value = true;
	error.value = null;

	try {
		const { data } = await api.get('/media-usage-analyzer/scan', { params: { content: scanContent.value } });
		report.value = data;
		const stillUnused = new Set(data.unusedFiles.map((file) => file.id));
		selected.value = new Set([...selected.value].filter((id) => stillUnused.has(id)));
	} catch (err) {
		error.value = errorMessage(err);
	} finally {
		loading.value = false;
	}
}

function toggle(id, checked) {
	const next = new Set(selected.value);
	if (checked) next.add(id);
	else next.delete(id);
	selected.value = next;
}

function selectAll(checked) {
	selected.value = checked ? new Set(report.value.unusedFiles.map((file) => file.id)) : new Set();
}

// The server re-checks every file in a dry run first, then deletes only the files it cleared
// (and re-verifies each batch again right before deleting it).
async function confirmDelete() {
	deleting.value = true;
	deleteResult.value = null;
	const ids = [...selected.value];

	try {
		const { data: preview } = await api.post(DELETE_URL, { ids, dryRun: true });
		const cleared = preview.results.filter((result) => result.status === 'would_delete').map((result) => result.id);
		const deletion = cleared.length ? (await api.post(DELETE_URL, { ids: cleared, dryRun: false })).data : null;
		const deleted = deletion?.summary.deleted ?? 0;
		deleteResult.value = { text: deletionResultText(preview, deletion), tone: deleted === ids.length ? 'success' : 'warning' };
		selected.value = new Set();
	} catch (err) {
		deleteResult.value = { text: `Nothing was deleted: ${errorMessage(err)}`, tone: 'danger' };
	} finally {
		deleting.value = false;
		deleteOpen.value = false;
	}

	await runScan();
}

function whereLabel(entry) {
	const collection = collectionsStore.getCollection(entry.usageCollection)?.name ?? entry.usageCollection;
	const field = fieldsStore.getField(entry.usageCollection, entry.usageField)?.name ?? entry.usageField;
	return `${collection} › ${field}${entry.kind === 'content' ? ' (link in text)' : ''}`;
}

function usedLabel(file) {
	return unusedIds.value.has(file.id) ? 'Unused' : 'In use';
}

function imageDetail(file) {
	const size = file.width && file.height ? `${file.width} × ${file.height} px` : 'Size unknown';
	return `${size} · ${usedLabel(file)}`;
}

function share(bytes) {
	const total = summary.value.totalBytes || 1;
	return `${Math.max(1, Math.round((bytes / total) * 100))}%`;
}

function errorMessage(err) {
	return err?.response?.data?.errors?.[0]?.message ?? err.message;
}

function exportReport(format) {
	const content = format === 'json' ? formatReportJson(report.value) : formatReportCsv(report.value);
	const blob = new Blob([content], { type: `${format === 'json' ? 'application/json' : 'text/csv'};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `media-usage-${new Date().toISOString().replaceAll(':', '-')}.${format}`;
	anchor.click();
	URL.revokeObjectURL(url);
}
</script>
<style scoped>
.media-usage-analyzer {
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

.hint {
	margin: 0;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

.views {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.view {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	box-sizing: border-box;
	padding: 8px 10px;
	border: none;
	border-left: 3px solid transparent;
	border-radius: var(--theme--border-radius);
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.view:hover:not(:disabled) {
	background: var(--theme--background-subdued);
}

.view.active {
	border-left-color: var(--theme--primary);
	background: color-mix(in srgb, var(--theme--primary) 12%, transparent);
}

.view:disabled {
	opacity: 0.5;
	cursor: default;
}

.view-label {
	flex: 1;
}

.dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--theme--primary);
}

.pill {
	flex: none;
	padding: 0 8px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 600;
	line-height: 18px;
	background: color-mix(in srgb, var(--pill, var(--theme--foreground-subdued)) 16%, transparent);
	color: var(--pill, var(--theme--foreground-subdued));
}

.pill.warning {
	--pill: var(--theme--warning);
}

.pill.danger {
	--pill: var(--theme--danger);
}

.pill.success {
	--pill: var(--theme--success);
}

.run-bar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 16px;
	min-height: 64px;
	padding: 12px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.run-title {
	display: flex;
	align-items: center;
	gap: 10px;
}

.run-hint {
	margin: 0;
	font-size: 13px;
}

.content {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
	overflow: auto;
}

.state {
	display: flex;
	flex: 1;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 16px;
	color: var(--theme--foreground-subdued);
}

.toolbar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
	padding: 10px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.toolbar .v-button {
	margin-left: auto;
}

.group-title {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 8px;
	margin: 0;
	padding: 16px var(--content-padding) 4px;
	font-weight: 600;
}

.section-title {
	margin: 0;
	padding: 20px var(--content-padding) 4px;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.rows {
	margin: 0;
	padding: 0;
	list-style: none;
}

.row {
	display: grid;
	grid-template-columns: 24px minmax(0, 1fr) auto;
	align-items: center;
	gap: 12px;
	padding: 10px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.name {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.open {
	color: var(--theme--primary);
}

.more {
	padding: 12px var(--content-padding);
}

.bars {
	margin: 0;
	padding: 12px var(--content-padding) 0;
	list-style: none;
}

.bar-row {
	display: grid;
	grid-template-columns: 110px minmax(0, 1fr) 200px;
	align-items: center;
	gap: 12px;
	padding: 6px 0;
}

.bar-track {
	height: 8px;
	border-radius: 4px;
	background: var(--theme--background-normal);
	overflow: hidden;
}

.bar {
	display: block;
	height: 100%;
	border-radius: 4px;
	background: var(--theme--primary);
}

.warning-text {
	color: var(--theme--warning);
}

.danger-text {
	color: var(--theme--danger);
}

.muted {
	color: var(--theme--foreground-subdued);
}

.small {
	font-size: 13px;
}

.cards {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 16px;
	padding: var(--content-padding);
}

.card {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 6px;
	padding: 20px;
	text-align: left;
	color: var(--theme--foreground);
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
}

.card:hover {
	border-color: var(--theme--primary);
}

.card.focus {
	border-left: 4px solid var(--theme--primary);
}

.card-label {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
	color: var(--theme--foreground-subdued);
	font-size: 13px;
}

.card-value {
	font-size: 28px;
	font-weight: 700;
	line-height: 1.2;
}

.card.success .card-value {
	color: var(--theme--success);
}

.card.warning .card-value {
	color: var(--theme--warning);
}

.card.danger .card-value {
	color: var(--theme--danger);
}
</style>
