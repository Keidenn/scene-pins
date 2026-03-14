const MODULE_ID = 'scene-pins';
const DEFAULT_PIN_IMAGE = 'icons/svg/marker.svg';
const DEFAULT_PIN_SIZE = 48;

class ScenePinsManager {
  constructor() {
    this.pins = [];
    this.pinsContainer = null;
    this.selectedPin = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.dragStartPos = { x: 0, y: 0 };
    this.pointerDownTime = 0;
    this.radialMenuOpen = false;
  }

  async initContainer() {
    if (this.pinsContainer) {
      this.pinsContainer.destroy({ children: true });
    }
    this.pinsContainer = new PIXI.Container();
    this.pinsContainer.sortableChildren = true;
    this.pinsContainer.zIndex = 500;
    this.pinsContainer.eventMode = 'passive';
    
    if (canvas.interface) {
      canvas.interface.addChild(this.pinsContainer);
    }
    
    await this.drawPins();
  }

  destroy() {
    if (this.pinsContainer) {
      this.pinsContainer.destroy({ children: true });
      this.pinsContainer = null;
    }
    this.pins = [];
  }

  async drawPins() {
    const scene = canvas.scene;
    if (!scene || !this.pinsContainer) return;

    this.pinsContainer.removeChildren().forEach(c => c.destroy());
    const pinsData = scene.getFlag(MODULE_ID, 'pins') || [];
    this.pins = [];

    for (const pinData of pinsData) {
      const pin = await this.createPinSprite(pinData);
      if (pin) {
        this.pinsContainer.addChild(pin);
        this.pins.push(pin);
      }
    }
  }

  async createPinSprite(pinData) {
    const texture = await loadTexture(pinData.img || DEFAULT_PIN_IMAGE);
    if (!texture) return null;

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.x = pinData.x;
    sprite.y = pinData.y;
    sprite.width = pinData.size || DEFAULT_PIN_SIZE;
    sprite.height = pinData.size || DEFAULT_PIN_SIZE;
    sprite.eventMode = 'static';
    sprite.cursor = 'pointer';
    sprite.pinData = pinData;

    sprite.on('pointerdown', (event) => this._onPinPointerDown(event, sprite));
    sprite.on('pointerup', (event) => this._onPinPointerUp(event, sprite));
    sprite.on('pointerupoutside', (event) => this._onPinPointerUp(event, sprite));
    sprite.on('pointermove', (event) => this._onPinPointerMove(event, sprite));
    sprite.on('rightclick', (event) => this._onPinRightClick(event, sprite));
    sprite.on('pointerover', (event) => this._onPinHoverIn(event, sprite));
    sprite.on('pointerout', (event) => this._onPinHoverOut(event, sprite));

    return sprite;
  }

  _onPinPointerDown(event, sprite) {
    if (event.data.button === 0) {
      if (game.user.isGM) {
        this.selectedPin = sprite;
        this.isDragging = false;
        this.dragStartPos = { x: sprite.x, y: sprite.y };
        const local = event.data.getLocalPosition(this.pinsContainer);
        this.dragOffset = {
          x: sprite.x - local.x,
          y: sprite.y - local.y
        };
      }
      this.pointerDownTime = Date.now();
      event.stopPropagation();
    }
  }

  _onPinPointerUp(event, sprite) {
    const timeDiff = Date.now() - this.pointerDownTime;
    const distMoved = this.selectedPin === sprite ? 
      Math.hypot(sprite.x - this.dragStartPos.x, sprite.y - this.dragStartPos.y) : 0;
    
    if (timeDiff < 300 && distMoved < 5) {
      this._onPinClick(event, sprite);
    } else if (this.isDragging && game.user.isGM) {
      this._updatePinPosition(sprite);
    }
    
    this.isDragging = false;
    this.selectedPin = null;
  }

  _onPinPointerMove(event, sprite) {
    if (this.selectedPin === sprite && game.user.isGM) {
      const local = event.data.getLocalPosition(this.pinsContainer);
      const newX = local.x + this.dragOffset.x;
      const newY = local.y + this.dragOffset.y;
      const distMoved = Math.hypot(newX - this.dragStartPos.x, newY - this.dragStartPos.y);
      
      if (distMoved > 5) {
        this.isDragging = true;
      }
      
      if (this.isDragging) {
        sprite.x = newX;
        sprite.y = newY;
      }
    }
  }

  async _onPinClick(event, sprite) {
    const pinData = sprite.pinData;
    const links = pinData.links || [];
    
    if (links.length === 0) {
      if (pinData.linkType && pinData.linkType !== 'none' && pinData.linkId) {
        this._openLink({ type: pinData.linkType, id: pinData.linkId });
      } else {
        ui.notifications.warn(game.i18n.localize('SCENE_PINS.NoTarget'));
      }
      return;
    }
    
    if (links.length === 1) {
      this._openLink(links[0]);
      return;
    }
    
    const screenPos = event.data.global;
    this._showRadialMenu(sprite, screenPos.x, screenPos.y, links);
  }

  _openLink(link) {
    switch (link.type) {
      case 'actor':
        const actor = game.actors.get(link.id);
        if (actor) actor.sheet.render(true);
        break;
      case 'item':
        const item = game.items.get(link.id);
        if (item) item.sheet.render(true);
        break;
      case 'scene':
        const scene = game.scenes.get(link.id);
        if (scene) scene.view();
        break;
    }
  }

  _showRadialMenu(sprite, screenX, screenY, links) {
    this._closeRadialMenu();
    this.radialMenuOpen = true;
    
    const radius = 80;
    const angleStep = (2 * Math.PI) / links.length;
    const startAngle = -Math.PI / 2;
    
    const menuContainer = $('<div class="scene-pin-radial-menu"></div>');
    menuContainer.css({
      position: 'fixed',
      left: screenX + 'px',
      top: screenY + 'px',
      zIndex: 1001,
      pointerEvents: 'none'
    });
    
    const centerDot = $('<div class="radial-center"></div>');
    centerDot.css({
      position: 'absolute',
      width: '12px',
      height: '12px',
      background: 'rgba(255,255,255,0.3)',
      borderRadius: '50%',
      transform: 'translate(-50%, -50%)'
    });
    menuContainer.append(centerDot);
    
    links.forEach((link, index) => {
      const angle = startAngle + (index * angleStep);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      
      let img = 'icons/svg/d20.svg';
      let name = 'Unknown';
      
      switch (link.type) {
        case 'actor':
          const actor = game.actors.get(link.id);
          if (actor) { img = actor.img || 'icons/svg/mystery-man.svg'; name = actor.name; }
          break;
        case 'item':
          const item = game.items.get(link.id);
          if (item) { img = item.img || 'icons/svg/item-bag.svg'; name = item.name; }
          break;
        case 'scene':
          const scene = game.scenes.get(link.id);
          if (scene) { img = scene.thumb || 'icons/svg/cave.svg'; name = scene.name; }
          break;
      }
      
      const linkBtn = $(`
        <div class="radial-link" data-index="${index}" title="${name}">
          <img src="${img}" alt="${name}" />
          <span class="radial-link-name">${name}</span>
        </div>
      `);
      
      linkBtn.css({
        position: 'absolute',
        left: x + 'px',
        top: y + 'px',
        transform: 'translate(-50%, -50%)',
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        background: '#1a1a1a',
        border: '2px solid #666',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        pointerEvents: 'auto',
        transition: 'transform 0.15s, border-color 0.15s'
      });
      
      linkBtn.find('img').css({
        width: '100%',
        height: '100%',
        objectFit: 'cover'
      });
      
      linkBtn.find('.radial-link-name').css({
        position: 'absolute',
        bottom: '-20px',
        left: '50%',
        transform: 'translateX(-50%)',
        whiteSpace: 'nowrap',
        fontSize: '11px',
        color: '#fff',
        textShadow: '0 0 3px #000',
        pointerEvents: 'none'
      });
      
      linkBtn.on('mouseenter', function() {
        $(this).css({ transform: 'translate(-50%, -50%) scale(1.15)', borderColor: '#ffd700' });
      });
      
      linkBtn.on('mouseleave', function() {
        $(this).css({ transform: 'translate(-50%, -50%) scale(1)', borderColor: '#666' });
      });
      
      linkBtn.on('click', () => {
        this._openLink(link);
        this._closeRadialMenu();
      });
      
      menuContainer.append(linkBtn);
    });
    
    $('body').append(menuContainer);
    
    setTimeout(() => {
      $(document).one('click', (e) => {
        if (!$(e.target).closest('.radial-link').length) {
          this._closeRadialMenu();
        }
      });
    }, 100);
  }

  _closeRadialMenu() {
    $('.scene-pin-radial-menu').remove();
    this.radialMenuOpen = false;
  }

  async _updatePinPosition(sprite) {
    const scene = canvas.scene;
    const pinsData = scene.getFlag(MODULE_ID, 'pins') || [];
    const pinIndex = pinsData.findIndex(p => p.id === sprite.pinData.id);
    
    if (pinIndex >= 0) {
      pinsData[pinIndex].x = sprite.x;
      pinsData[pinIndex].y = sprite.y;
      await scene.setFlag(MODULE_ID, 'pins', pinsData);
    }
  }

  _onPinRightClick(event, sprite) {
    if (!game.user.isGM) return;
    event.stopPropagation();
    
    const x = event.data.global.x;
    const y = event.data.global.y;
    
    $('.scene-pin-context-menu').remove();
    
    const menuHtml = $(`
      <nav class="scene-pin-context-menu" style="position:fixed; left:${x}px; top:${y}px; z-index:1000; background:#1a1a1a; border:1px solid #444; border-radius:4px; padding:4px 0; min-width:150px;">
        <ol class="context-items" style="list-style:none; margin:0; padding:0;">
          <li class="context-item" data-action="edit" style="padding:6px 12px; cursor:pointer; display:flex; align-items:center; gap:8px;">
            <i class="fas fa-edit"></i> ${game.i18n.localize('SCENE_PINS.EditPin')}
          </li>
          <li class="context-item" data-action="delete" style="padding:6px 12px; cursor:pointer; display:flex; align-items:center; gap:8px; color:#ff6666;">
            <i class="fas fa-trash"></i> ${game.i18n.localize('SCENE_PINS.DeletePin')}
          </li>
        </ol>
      </nav>
    `);
    
    $('body').append(menuHtml);
    
    menuHtml.find('[data-action="edit"]').on('click', () => {
      this._editPin(sprite);
      menuHtml.remove();
    });
    
    menuHtml.find('[data-action="delete"]').on('click', () => {
      this._deletePin(sprite);
      menuHtml.remove();
    });
    
    menuHtml.find('.context-item').hover(
      function() { $(this).css('background', '#333'); },
      function() { $(this).css('background', 'transparent'); }
    );
    
    setTimeout(() => {
      $(document).one('click', () => menuHtml.remove());
    }, 100);
  }

  _onPinHoverIn(event, sprite) {
    const name = sprite.pinData.name || 'Pin';
    const links = sprite.pinData.links || [];
    let tooltip = name;
    if (links.length > 1) {
      tooltip += ` (${links.length} liens)`;
    }
    this._showTooltip(sprite, tooltip);
  }

  _onPinHoverOut(event, sprite) {
    this._hideTooltip();
  }

  _showTooltip(sprite, text) {
    this._hideTooltip();
    const screenPos = canvas.stage.toGlobal(new PIXI.Point(sprite.x, sprite.y - sprite.height));
    const tooltip = $(`<div class="scene-pin-tooltip">${text}</div>`);
    tooltip.css({
      left: screenPos.x + 'px',
      top: (screenPos.y - 25) + 'px'
    });
    $('body').append(tooltip);
  }

  _hideTooltip() {
    $('.scene-pin-tooltip').remove();
  }

  async _editPin(sprite) {
    new ScenePinConfig(sprite.pinData).render(true);
  }

  async _deletePin(sprite) {
    const scene = canvas.scene;
    const pinsData = scene.getFlag(MODULE_ID, 'pins') || [];
    const newPins = pinsData.filter(p => p.id !== sprite.pinData.id);
    await scene.setFlag(MODULE_ID, 'pins', newPins);
    this._emitRefresh();
    await this.drawPins();
  }

  async createPin(x, y) {
    const defaultImg = game.settings.get(MODULE_ID, 'defaultPinImage') || DEFAULT_PIN_IMAGE;
    const defaultSize = game.settings.get(MODULE_ID, 'defaultPinSize') || DEFAULT_PIN_SIZE;
    
    const pinData = {
      id: foundry.utils.randomID(),
      x: x,
      y: y,
      img: defaultImg,
      size: defaultSize,
      name: 'New Pin',
      links: [],
      defaultLinkIndex: 0
    };

    const scene = canvas.scene;
    const pinsData = scene.getFlag(MODULE_ID, 'pins') || [];
    pinsData.push(pinData);
    await scene.setFlag(MODULE_ID, 'pins', pinsData);
    
    new ScenePinConfig(pinData).render(true);
    this._emitRefresh();
    await this.drawPins();
  }

  _emitRefresh() {
    game.socket.emit(`module.${MODULE_ID}`, { action: 'refresh', sceneId: canvas.scene.id });
  }

  getDefaultSceneLink(pinData) {
    const links = pinData.links || [];
    if (links.length === 0) {
      if (pinData.linkType === 'scene' && pinData.linkId) {
        return pinData.linkId;
      }
      return null;
    }
    const defaultIndex = pinData.defaultLinkIndex || 0;
    const defaultLink = links[defaultIndex] || links[0];
    if (defaultLink && defaultLink.type === 'scene') {
      return defaultLink.id;
    }
    const sceneLink = links.find(l => l.type === 'scene');
    return sceneLink ? sceneLink.id : null;
  }
}

class ScenePinConfig extends FormApplication {
  constructor(pinData, options = {}) {
    super(pinData, options);
    this.pinData = foundry.utils.deepClone(pinData);
    if (!this.pinData.links) this.pinData.links = [];
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'scene-pin-config',
      title: game.i18n.localize('SCENE_PINS.EditPin'),
      template: `modules/${MODULE_ID}/templates/pin-config.hbs`,
      classes: ['scene-pins-config'],
      width: 500,
      height: 'auto',
      closeOnSubmit: false,
      submitOnChange: false
    });
  }

  getData() {
    const enrichedLinks = (this.pinData.links || []).map((link, index) => {
      const { img, name } = this._getEntityData(link.type, link.id);
      return {
        ...link,
        img,
        name,
        index,
        isDefault: index === (this.pinData.defaultLinkIndex || 0)
      };
    });

    return {
      pin: this.pinData,
      links: enrichedLinks,
      linkTypes: [
        { value: 'actor', label: game.i18n.localize('SCENE_PINS.Actor') },
        { value: 'item', label: game.i18n.localize('SCENE_PINS.Item') },
        { value: 'scene', label: game.i18n.localize('SCENE_PINS.Scene') }
      ]
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('button.file-picker').click(ev => {
      const target = ev.currentTarget.dataset.target;
      const fp = new FilePicker({
        type: 'image',
        current: this.pinData.img,
        callback: path => {
          html.find(`input[name="${target}"]`).val(path);
          html.find('.image-preview').attr('src', path);
        }
      });
      fp.browse();
    });

    html.find('.add-link-type').change(ev => {
      this._updateAddLinkOptions(html, ev.currentTarget.value);
    });

    html.find('.add-link-target').change(ev => {
      this._updateAddLinkPreview(html);
    });

    html.find('.add-link-btn').click(ev => {
      this._addLink(html);
    });

    html.find('.remove-link-btn').click(ev => {
      const index = parseInt($(ev.currentTarget).data('index'));
      this._removeLink(index);
    });

    html.find('.set-default-btn').click(ev => {
      const index = parseInt($(ev.currentTarget).data('index'));
      this._setDefaultLink(index);
    });

    html.find('button[type="submit"]').click(ev => {
      ev.preventDefault();
      this._savePin(html);
    });

    this._updateAddLinkOptions(html, 'scene');
  }

  _getEntityData(type, id) {
    let entity, img, name;
    switch (type) {
      case 'actor':
        entity = game.actors.get(id);
        img = entity?.img || 'icons/svg/mystery-man.svg';
        name = entity?.name || 'Unknown';
        break;
      case 'item':
        entity = game.items.get(id);
        img = entity?.img || 'icons/svg/item-bag.svg';
        name = entity?.name || 'Unknown';
        break;
      case 'scene':
        entity = game.scenes.get(id);
        img = entity?.thumb || 'icons/svg/cave.svg';
        name = entity?.name || 'Unknown';
        break;
    }
    return { img, name };
  }

  _updateAddLinkPreview(html) {
    const type = html.find('.add-link-type').val();
    const id = html.find('.add-link-target').val();
    if (id) {
      const { img } = this._getEntityData(type, id);
      html.find('.add-link-preview').attr('src', img);
    }
  }

  _updateAddLinkOptions(html, linkType) {
    const targetSelect = html.find('.add-link-target');
    targetSelect.empty();
    targetSelect.append(`<option value="">${game.i18n.localize('SCENE_PINS.SelectTarget')}</option>`);

    let options = [];
    switch (linkType) {
      case 'actor':
        options = game.actors.contents.map(a => ({
          id: a.id,
          name: a.name,
          img: a.img || 'icons/svg/mystery-man.svg'
        }));
        break;
      case 'item':
        options = game.items.contents.map(i => ({
          id: i.id,
          name: i.name,
          img: i.img || 'icons/svg/item-bag.svg'
        }));
        break;
      case 'scene':
        options = game.scenes.contents.filter(s => s.id !== canvas.scene.id).map(s => ({
          id: s.id,
          name: s.name,
          img: s.thumb || 'icons/svg/cave.svg'
        }));
        break;
    }

    options.forEach(opt => {
      targetSelect.append(`<option value="${opt.id}" data-img="${opt.img}">${opt.name}</option>`);
    });

    html.find('.add-link-preview').attr('src', 'icons/svg/d20.svg');
  }

  _addLink(html) {
    const type = html.find('.add-link-type').val();
    const id = html.find('.add-link-target').val();
    
    if (!id) {
      ui.notifications.warn("Sélectionnez un élément à ajouter");
      return;
    }

    const exists = this.pinData.links.some(l => l.type === type && l.id === id);
    if (exists) {
      ui.notifications.warn("Ce lien existe déjà");
      return;
    }

    this.pinData.links.push({ type, id });
    this.render();
  }

  _removeLink(index) {
    this.pinData.links.splice(index, 1);
    if (this.pinData.defaultLinkIndex >= this.pinData.links.length) {
      this.pinData.defaultLinkIndex = Math.max(0, this.pinData.links.length - 1);
    }
    this.render();
  }

  _setDefaultLink(index) {
    this.pinData.defaultLinkIndex = index;
    this.render();
  }

  async _savePin(html) {
    const name = html.find('input[name="name"]').val();
    const img = html.find('input[name="img"]').val();
    const size = parseInt(html.find('input[name="size"]').val()) || DEFAULT_PIN_SIZE;

    const scene = canvas.scene;
    const pinsData = scene.getFlag(MODULE_ID, 'pins') || [];
    const pinIndex = pinsData.findIndex(p => p.id === this.pinData.id);

    if (pinIndex >= 0) {
      pinsData[pinIndex].name = name;
      pinsData[pinIndex].img = img;
      pinsData[pinIndex].size = size;
      pinsData[pinIndex].links = this.pinData.links;
      pinsData[pinIndex].defaultLinkIndex = this.pinData.defaultLinkIndex || 0;
      
      await scene.setFlag(MODULE_ID, 'pins', pinsData);
      canvas.scenePins._emitRefresh();
      await canvas.scenePins.drawPins();
    }
    
    this.close();
  }

  async _updateObject(event, formData) {
  }
}

let pinModeActive = false;

const scenePinsManager = new ScenePinsManager();

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing Scene Pins module`);
  foundry.applications.handlebars.loadTemplates([`modules/${MODULE_ID}/templates/pin-config.hbs`]);
  
  game.settings.register(MODULE_ID, 'defaultPinImage', {
    name: 'Image par défaut des pins',
    hint: 'Chemin vers l\'image utilisée par défaut pour les nouveaux pins',
    scope: 'world',
    config: true,
    type: String,
    default: 'icons/svg/marker.svg',
    filePicker: 'image'
  });
  
  game.settings.register(MODULE_ID, 'defaultPinSize', {
    name: 'Taille par défaut des pins',
    hint: 'Taille en pixels des nouveaux pins',
    scope: 'world',
    config: true,
    type: Number,
    default: 48,
    range: { min: 16, max: 128, step: 8 }
  });

  game.settings.register(MODULE_ID, 'worldmapScene', {
    name: 'Scène Worldmap (par défaut)',
    hint: 'La scène principale vers laquelle retourner en dézoomant au maximum',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    choices: {}
  });
  
  game.keybindings.register(MODULE_ID, 'togglePinMode', {
    name: 'Toggle Pin Mode',
    hint: 'Activer/désactiver le mode création de pin',
    editable: [{ key: 'KeyP', modifiers: ['Shift'] }],
    onDown: () => {
      if (!game.user.isGM) return;
      pinModeActive = !pinModeActive;
      ui.notifications.info(pinModeActive ? 
        "Mode Pin activé (Shift+P) - Cliquez sur la carte" : 
        "Mode Pin désactivé");
    }
  });
});

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | Scene Pins module ready`);
  canvas.scenePins = scenePinsManager;
  
  const sceneChoices = { '': '-- Aucune --' };
  game.scenes.contents.forEach(s => {
    sceneChoices[s.id] = s.name;
  });
  game.settings.settings.get(`${MODULE_ID}.worldmapScene`).choices = sceneChoices;
  
  game.scenePins = {
    togglePinMode: () => {
      if (!game.user.isGM) return;
      pinModeActive = !pinModeActive;
      ui.notifications.info(pinModeActive ? 
        "Mode Pin activé - Cliquez sur la carte" : 
        "Mode Pin désactivé");
    },
    isActive: () => pinModeActive
  };

  game.socket.on(`module.${MODULE_ID}`, async (data) => {
    if (data.action === 'refresh' && data.sceneId === canvas.scene?.id) {
      await scenePinsManager.drawPins();
    }
  });
});

let clickListenerAdded = false;

Hooks.on('canvasReady', async () => {
  await scenePinsManager.initContainer();
  
  if (!clickListenerAdded) {
    const canvasElement = document.getElementById('board');
    if (canvasElement) {
      canvasElement.addEventListener('click', (event) => {
        if (!pinModeActive) return;
        if (event.button !== 0) return;
        if (!game.user.isGM) return;
        
        const rect = canvasElement.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        
        const transform = canvas.stage.worldTransform;
        const x = (screenX - transform.tx) / transform.a;
        const y = (screenY - transform.ty) / transform.d;
        
        scenePinsManager.createPin(x, y);
        
        pinModeActive = false;
        ui.notifications.info("Pin créé - Mode Pin désactivé");
      }, true);
      clickListenerAdded = true;
    }
  }
});

Hooks.on('canvasTearDown', () => {
  scenePinsManager.destroy();
});

let zoomNavigationCooldown = false;
let worldmapPromptCooldown = false;
let zoomWheelListenerAdded = false;
let lastWheelScale = 1;
let zoomOutAttempts = 0;
let zoomInAttempts = 0;

Hooks.on('canvasReady', () => {
  lastWheelScale = canvas.stage?.scale?.x || 1;
  zoomOutAttempts = 0;
  zoomInAttempts = 0;
  
  if (zoomWheelListenerAdded) return;
  
  const canvasElement = document.getElementById('board');
  if (!canvasElement) return;
  
  canvasElement.addEventListener('wheel', (event) => {
    const currentScale = canvas.stage?.scale?.x;
    if (!currentScale) return;
    
    const isScrollingUp = event.deltaY < 0;
    const isScrollingDown = event.deltaY > 0;
    const scaleChanged = Math.abs(currentScale - lastWheelScale) > 0.001;
    
    if (isScrollingUp) {
      zoomOutAttempts = 0;
      if (!scaleChanged) {
        zoomInAttempts++;
        if (zoomInAttempts >= 2 && !zoomNavigationCooldown) {
          zoomInAttempts = 0;
          _handleZoomInTeleport();
        }
      } else {
        zoomInAttempts = 0;
      }
    }
    
    if (isScrollingDown) {
      zoomInAttempts = 0;
      if (!scaleChanged) {
        zoomOutAttempts++;
        if (zoomOutAttempts >= 2 && !worldmapPromptCooldown) {
          zoomOutAttempts = 0;
          _handleZoomOutWorldmap();
        }
      } else {
        zoomOutAttempts = 0;
      }
    }
    
    lastWheelScale = currentScale;
  }, { passive: true });
  
  zoomWheelListenerAdded = true;
});

function _handleZoomInTeleport() {
  if (!scenePinsManager.pins.length) return;
  
  const currentScale = canvas.stage.scale.x;
  const viewCenterX = canvas.stage.pivot.x;
  const viewCenterY = canvas.stage.pivot.y;
  const threshold = 150;

  let closestPin = null;
  let closestDistance = Infinity;

  for (const pin of scenePinsManager.pins) {
    const sceneId = scenePinsManager.getDefaultSceneLink(pin.pinData);
    if (!sceneId) continue;

    const distance = Math.hypot(pin.x - viewCenterX, pin.y - viewCenterY);

    if (distance < threshold && distance < closestDistance) {
      closestDistance = distance;
      closestPin = { pin, sceneId };
    }
  }

  if (closestPin) {
    const scene = game.scenes.get(closestPin.sceneId);
    if (scene) {
      zoomNavigationCooldown = true;
      setTimeout(() => { zoomNavigationCooldown = false; }, 2000);
      scene.view();
    }
  }
}

function _handleZoomOutWorldmap() {
  const worldmapSceneId = game.settings.get(MODULE_ID, 'worldmapScene');
  if (!worldmapSceneId) return;
  
  if (canvas.scene?.id === worldmapSceneId) return;
  
  const worldmapScene = game.scenes.get(worldmapSceneId);
  if (!worldmapScene) return;

  worldmapPromptCooldown = true;
  
  const dialogContent = `
    <p>Voulez-vous retourner sur la worldmap ?</p>
    <div style="margin-top: 10px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="scene-pins-no-ask" />
        Ne pas redemander pendant 10 minutes
      </label>
    </div>
  `;

  new Dialog({
    title: "Retour à la Worldmap",
    content: dialogContent,
    buttons: {
      yes: {
        icon: '<i class="fas fa-check"></i>',
        label: "Oui",
        callback: (html) => {
          const noAsk = html.find('#scene-pins-no-ask').is(':checked');
          if (noAsk) {
            worldmapPromptCooldown = true;
            setTimeout(() => { worldmapPromptCooldown = false; }, 10 * 60 * 1000);
          } else {
            worldmapPromptCooldown = false;
          }
          worldmapScene.view();
        }
      },
      no: {
        icon: '<i class="fas fa-times"></i>',
        label: "Non",
        callback: (html) => {
          const noAsk = html.find('#scene-pins-no-ask').is(':checked');
          if (noAsk) {
            worldmapPromptCooldown = true;
            setTimeout(() => { worldmapPromptCooldown = false; }, 10 * 60 * 1000);
          } else {
            worldmapPromptCooldown = false;
          }
        }
      }
    },
    default: "no"
  }).render(true);
}
