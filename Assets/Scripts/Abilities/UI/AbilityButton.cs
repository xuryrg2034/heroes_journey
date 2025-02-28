using System;
using Abilities.Hero;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

namespace Abilities.UI
{
    public class AbilityButton : MonoBehaviour
    {
        private BaseAbility _ability;
        
        private bool _interactable;

        private Button _button;

        private Action<BaseAbility> _callback;

        private TMP_Text _tmp;

        private void OnDisable()
        {
            _ability.OnEnableChanged.RemoveListener(_handleChangeAbilityEnabled);
            _button.onClick.RemoveListener(_callbackInvoke);
        }

        public void Init(BaseAbility ability, Action<BaseAbility> callback)
        {
            _ability = ability;
            _callback = callback;
            _interactable = _ability.Enable;
            _button = GetComponent<Button>();
            _tmp = GetComponentInChildren<TMP_Text>();

            _prepareButton();
            _prepareText();

            _ability.OnEnableChanged.AddListener(_handleChangeAbilityEnabled);
        }

        // Попытка поменять состоянии извне
        public void TryToggleInteractable(bool state)
        {
            _button.interactable = state && _ability.Enable;
        }

        private void _prepareButton()
        {
            _button.interactable = _interactable;
            _button.onClick.AddListener(_callbackInvoke);
        }

        private void _callbackInvoke()
        {
            _callback.Invoke(_ability);
        }
        
        private void _prepareText()
        {
            _tmp.text = _ability.Title;
        }
        
        private void _handleChangeAbilityEnabled(bool state)
        {
            _interactable = state;
        }
    }
}