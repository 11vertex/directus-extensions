export default {
	plugins: [
		{
			name: 'externalize-directus-api',
			options(options) {
				const previous = options.external;

				options.external = (id, importer, isResolved) => {
					if (id === '@directus/api' || id.startsWith('@directus/api/')) {
						return true;
					}

					if (typeof previous === 'function') {
						return previous(id, importer, isResolved);
					}

					if (Array.isArray(previous)) {
						return previous.some((entry) => {
							if (typeof entry === 'string') return entry === id;
							if (entry instanceof RegExp) return entry.test(id);
							return false;
						});
					}

					return false;
				};
			},
		},
	],
};
