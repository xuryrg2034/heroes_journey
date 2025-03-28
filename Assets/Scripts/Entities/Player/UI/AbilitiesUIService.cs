using System;
using System.Collections.Generic;
using Services;
using UnityEngine;
using UnityEngine.UI;

namespace Entities.Player
{
    public class AbilitiesUIService : MonoBehaviour
    {
        [SerializeField] Button executeButton;
        [SerializeField] Transform containerPrefab;
        [SerializeField] AbilityButton itemPrefab;

        List<AbilityButton> _buttonList = new();
        AbilitiesService _abilitiesService;
        bool _isInit;

        void Update()
        {
            if (!_isInit) return;

            _toggleExecuteButtonInteractable();
        }

        public void Init(AbilitiesService service)
        {
            _abilitiesService = service;

            foreach (Transform child in containerPrefab)
            {
                Destroy(child.gameObject);
            }

            foreach (var ability in _abilitiesService.Abilities)
            {
                var button = Instantiate(itemPrefab, containerPrefab);
                
                button.Init(ability, _abilitiesService.SelectAbility);
                
                _buttonList.Add(button);
            }

            _isInit = true;
        }


        void _toggleExecuteButtonInteractable()
        {
            var interactable =
                GameService.CurrentState == GameState.WaitingForInput &&
                _abilitiesService.SelectedAbility != null;

            executeButton.interactable = interactable;
        }
    }
}

