using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Entities.Player
{
    public class AbilityButton : MonoBehaviour
    {
        [SerializeField] GameObject selection;
        [SerializeField] GameObject icon;

        BaseAbility _ability;
        
        bool _interactable = true;

        Button _button;

        Action<BaseAbility> _callback;

        void OnDisable()
        {
            _button.onClick.RemoveListener(CallbackInvoke);
            _ability.OnSelected.RemoveListener(ToggleSelection);
        }

        void Update()
        {
        }

        public void Init(BaseAbility ability, Action<BaseAbility> callback)
        {
            _ability = ability;
            _callback = callback;
            _button = GetComponent<Button>();

            PrepareButton();
            PrepareIcon();
        }

        void PrepareButton()
        {
            _button.interactable = _interactable;
            _button.onClick.AddListener(CallbackInvoke);
            _ability.OnSelected.AddListener(ToggleSelection);
        }

        void PrepareIcon()
        {
            icon.GetComponent<Image>().sprite = _ability.Icon;
        }

        void CallbackInvoke()
        {
            _callback.Invoke(_ability);
        }

        void ToggleSelection(bool value)
        {
            selection.gameObject.SetActive(value);
        }
    }
}