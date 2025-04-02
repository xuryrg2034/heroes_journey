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
        
        AbilitiesService _abilitiesService;
        
        UiStateService _uiStateService;
        
        BaseAbility SelectedAbility => _abilitiesService.SelectedAbility;

        void Start()
        {
            _abilitiesService = ServiceLocator.Get<AbilitiesService>();
            _uiStateService = ServiceLocator.Get<UiStateService>();

            CreateAbilityButtons();
        }
        
        void Update()
        {
            ToggleExecuteButtonInteractable();
        }

        void CreateAbilityButtons()
        {
            foreach (Transform child in containerPrefab)
            {
                Destroy(child.gameObject);
            }

            foreach (var ability in _abilitiesService.Abilities)
            {
                var button = Instantiate(itemPrefab, containerPrefab);
                
                button.Init(ability, HandleClickAbilityButton);
            }
        }

        void ToggleExecuteButtonInteractable()
        {
            var interactable =
                SelectedAbility &&
                SelectedAbility.CanBeExecute &&
                _uiStateService.CurrentState == UiGameState.Idle;

            executeButton.interactable = interactable;
        }

        void HandleClickAbilityButton(BaseAbility ability)
        {
            // Запрет на смену абилки, пока игра не в состоянии Idle
            if (_uiStateService.CurrentState != UiGameState.Idle) return;

            _abilitiesService.SelectAbility(ability);
        }
    }
}

