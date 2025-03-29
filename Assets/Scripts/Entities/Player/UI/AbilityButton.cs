using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Entities.Player
{
    public class AbilityButton : MonoBehaviour
    {
        BaseAbility _ability;
        
        bool _interactable = true;

        Button _button;

        Action<BaseAbility> _callback;

        TMP_Text _tmp;

        void OnDisable()
        {
            _button.onClick.RemoveListener(_callbackInvoke);
        }

        void Update()
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

        void _prepareButton()
        {
            _button.interactable = _interactable;
            _button.onClick.AddListener(_callbackInvoke);
        }

        void _callbackInvoke()
        {
            _callback.Invoke(_ability);
        }
        
        void _prepareText()
        {
            _tmp.text = _ability.Title;
        }
    }
}