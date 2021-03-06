import macro from 'vtk.js/Sources/macro';

const { capitalize, vtkErrorMacro } = macro;

// ----------------------------------------------------------------------------
// Proxy Registration Handling
// ----------------------------------------------------------------------------

export default function addRegistrationAPI(publicAPI, model) {
  function registerProxy(proxy) {
    if (!proxy) {
      return;
    }
    model.proxyIdMapping[proxy.getProxyId()] = proxy;
    const group = proxy.getProxyGroup();
    if (!model.proxyByGroup[group]) {
      model.proxyByGroup[group] = [];
    }
    if (model.proxyByGroup[group].indexOf(proxy) === -1) {
      model.proxyByGroup[group].push(proxy);
    }
    proxy.setProxyManager(publicAPI);
  }

  // --------------------------------------------------------------------------

  function unRegisterProxy(proxyOrId) {
    const id = proxyOrId.getProxyId ? proxyOrId.getProxyId() : proxyOrId;
    const proxy = model.proxyIdMapping[id];

    // Unregister proxy in any group
    Object.keys(model.proxyByGroup).forEach((groupName) => {
      const proxyList = model.proxyByGroup[groupName];
      const index = proxyList.indexOf(proxy);
      if (index !== -1) {
        proxyList.splice(index, 1);
      }
    });

    delete model.proxyIdMapping[id];
    proxy.setProxyManager(null);
    return proxy;
  }

  // --------------------------------------------------------------------------

  publicAPI.setActiveSource = (source) => {
    if (model.activeSource !== source) {
      if (model.activeSourceSubscription) {
        model.activeSourceSubscription.unsubscribe();
        model.activeSourceSubscription = null;
      }
      model.activeSource = source;
      if (source) {
        model.activeSourceSubscription = source.onModified(publicAPI.modified);
      }
      publicAPI.modified();
      publicAPI.invokeActiveSourceChange(source);
    }
  };

  publicAPI.setActiveView = (view) => {
    if (model.activeView !== view) {
      if (model.activeViewSubscription) {
        model.activeViewSubscription.unsubscribe();
        model.activeViewSubscription = null;
      }
      model.activeView = view;
      if (view) {
        model.activeViewSubscription = view.onModified(publicAPI.modified);
      }
      publicAPI.modified();
      publicAPI.invokeActiveViewChange(view);
    }
  };

  // --------------------------------------------------------------------------

  publicAPI.getProxyById = (id) => model.proxyIdMapping[id];

  // --------------------------------------------------------------------------

  publicAPI.getProxyGroups = () => Object.keys(model.proxyByGroup);

  // --------------------------------------------------------------------------

  publicAPI.getProxyInGroup = (name) =>
    [].concat(model.proxyByGroup[name] || []);

  // --------------------------------------------------------------------------

  publicAPI.getSources = () => [].concat(model.proxyByGroup.Sources || []);
  publicAPI.getRepresentations = () =>
    [].concat(model.proxyByGroup.Representations || []);
  publicAPI.getViews = () => [].concat(model.proxyByGroup.Views || []);

  // --------------------------------------------------------------------------

  publicAPI.createProxy = (group, name, options) => {
    const { definitions } = model.proxyConfiguration;
    if (!definitions[group] || !definitions[group][name]) {
      return null;
    }
    const definition = definitions[group][name];
    const proxy = definition.class.newInstance(
      Object.assign({}, definition.options, options, {
        proxyGroup: group,
        proxyName: name,
        proxyManager: publicAPI,
      })
    );
    registerProxy(proxy);

    // Automatically make it active if possible
    const getActiveMethod = `getActive${capitalize(
      proxy.getProxyGroup().slice(0, -1)
    )}`;
    if (publicAPI[getActiveMethod] && !publicAPI[getActiveMethod]()) {
      publicAPI[`setActive${capitalize(proxy.getProxyGroup().slice(0, -1))}`](
        proxy
      );
    }

    return proxy;
  };

  // --------------------------------------------------------------------------

  publicAPI.getRepresentation = (source, view) => {
    const sourceToUse = source || publicAPI.getActiveSource();
    const viewToUse = view || publicAPI.getActiveView();

    // Can only get a representation for a source and a view
    if (!sourceToUse || !viewToUse) {
      return null;
    }

    const sourceId = sourceToUse.getProxyId();
    const viewId = viewToUse.getProxyId();

    let viewRepMap = model.sv2rMapping[sourceId];
    if (!viewRepMap) {
      viewRepMap = {};
      model.sv2rMapping[sourceId] = viewRepMap;
    }
    let rep = viewRepMap[viewId];
    if (!rep) {
      const viewName = viewToUse.getProxyName();
      const sourceType = sourceToUse.getType();
      const definition =
        model.proxyConfiguration.representations[viewName][sourceType];
      if (!definition) {
        vtkErrorMacro(
          `No definition for representation of ${sourceType} in view ${viewName}`
        );
        return null;
      }
      rep = publicAPI.createProxy(
        'Representations',
        definition.name,
        definition.options
      );
      rep.setInput(sourceToUse);
      viewToUse.addRepresentation(rep);
      model.r2svMapping[rep.getProxyId()] = { sourceId, viewId };
      viewRepMap[viewId] = rep;
    }
    return rep;
  };

  // --------------------------------------------------------------------------

  publicAPI.deleteProxy = (proxy) => {
    const group = proxy.getProxyGroup().toLowerCase();

    if (group === 'views') {
      proxy.getRepresentations().forEach((repProxy) => {
        publicAPI.deleteProxy(repProxy);
      });
      unRegisterProxy(proxy);
      if (publicAPI.getActiveView() === proxy) {
        publicAPI.setActiveView(publicAPI.getViews()[0]);
      }
    }

    if (group === 'representations') {
      const { sourceId, viewId } = model.r2svMapping[proxy.getProxyId()];
      const view = publicAPI.getProxyById(viewId);
      view.removeRepresentation(proxy);
      delete model.r2svMapping[proxy.getProxyId()];
      delete model.sv2rMapping[sourceId][viewId];
      unRegisterProxy(proxy);
    }

    if (group === 'sources') {
      const viewToRep = model.sv2rMapping[proxy.getProxyId()];
      Object.keys(viewToRep).forEach((viewId) => {
        publicAPI.deleteProxy(viewToRep[viewId]);
      });
      unRegisterProxy(proxy);
      if (publicAPI.getActiveSource() === proxy) {
        publicAPI.setActiveSource(publicAPI.getSources()[0]);
      }
    }

    // Delete the object itself
    proxy.delete();
  };
}
