using System;
using System.Collections.Generic;
using Services;
using UnityEngine;
using UnityEngine.UI;

namespace Entities.Player
{
    public class AbilitiesUIService : MonoBehaviour
    {
        [SerializeField] private Button executeButton;
        [SerializeField] private Transform containerPrefab;
        [SerializeField] private AbilityButton itemPrefab;

        private List<AbilityButton> _buttonList = new();
        private AbilitiesService _abilitiesService;
        private bool _isInit;

        private void Start()
        {
            // GameService.OnGameStateChange.AddListener(_toggleButtonInteractable);
        }

        private void Update()
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

            foreach (var ability in _abilitiesService.AbilitiesList)
            {
                var button = Instantiate(itemPrefab, containerPrefab);
                
                button.Init(ability, _abilitiesService.SelectAbility);
                
                _buttonList.Add(button);
            }

            _isInit = true;
        }


        private void _toggleExecuteButtonInteractable()
        {
            var interactable =
                GameService.CurrentState == GameState.WaitingForInput &&
                _abilitiesService.SelectedAbility != null;

            executeButton.interactable = interactable;
        }

        // private void _toggleButtonInteractable(GameState state)
        // {
        //     foreach (var button in _buttonList)
        //     {
        //         button.TryToggleInteractable(state == GameState.WaitingForInput);
        //     }
        // }
    }
}

