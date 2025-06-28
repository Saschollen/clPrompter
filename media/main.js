
(function () {
	const vscode = acquireVsCodeApi();

	window.addEventListener('message', event => {
		const message = event.data;
		if (message.type === 'loadForm' && message.xml) {
			loadFormFromXml(message.xml);
		}
	});

	function loadFormFromXml(xml) {
		const parser = new DOMParser();
		const xmlDoc = parser.parseFromString(xml, 'text/xml');
		const parameters = xmlDoc.getElementsByTagName('parameter');

		const form = document.createElement('form');
		form.id = 'clForm';

		for (let param of parameters) {
			const name = param.getAttribute('name') || '';
			const prompt = param.getAttribute('prompt') || name;
			const defValue = param.getElementsByTagName('default')[0]?.textContent || '';

			const label = document.createElement('label');
			label.textContent = prompt;
			label.htmlFor = name;

			const input = document.createElement('input');
			input.name = name;
			input.value = defValue;

			form.appendChild(label);
			form.appendChild(document.createElement('br'));
			form.appendChild(input);
			form.appendChild(document.createElement('br'));
		}

		const submit = document.createElement('button');
		submit.textContent = 'Generate Command';
		submit.type = 'submit';
		form.appendChild(submit);

		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const formData = {};
			for (const element of form.elements) {
				if (element.name) {
					formData[element.name] = element.value;
				}
			}
			vscode.postMessage({ type: 'submitCL', values: formData });
		});

		document.body.innerHTML = ''; // Clear previous content
		document.body.appendChild(form);
	}
})();