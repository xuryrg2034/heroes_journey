using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Entities.Player
{
    public class AbilityButton : MonoBehaviour
    {
        private BaseAbility _ability;
        
        private bool _interactable = true;

        private Button _button;

        private Action<BaseAbility> _callback;

        private TMP_Text _tmp;

        private void OnDisable()
        {
            _button.onClick.RemoveListener(_callbackInvoke);
        }

        private void Update()
        {
        }

        public void Init(BaseAbility ability, Action<BaseAbility> callback)
        {
            _ability = ability;
            _callback = callback;
            _button = GetComponent<Button>();
            _tmp = GetComponentInChildren<TMP_Text>();

            _prepareButton();
            _prepareText();
        }

        // Попытка поменять состоянии извне
        // public void TryToggleInteractable(bool state)
        // {
        //     _button.interactable = state && _ability.Enable;
        // }

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
    }
}