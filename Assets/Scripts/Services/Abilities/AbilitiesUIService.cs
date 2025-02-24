using System;
using System.Collections.Generic;
using Services.Abilities;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Services.Abilities
{
    public class AbilitiesUIService : MonoBehaviour
    {
        [SerializeField] private Transform containerPrefab;
        [SerializeField] private Button itemPrefab;

        private List<Button> _buttonList = new();
        private AbilitiesService _abilitiesService;

        private void Start()
        {
            GameService.OnGameStateChange.AddListener(_toggleButtonInteractable);
        }

        public void Init(AbilitiesService service)
        {
            foreach (Transform child in containerPrefab)
            {
                Destroy(child.gameObject);
            }

            foreach (var ability in service.AbilitiesList)
            {
                var button = Instantiate(itemPrefab, containerPrefab);
                var buttonText = button.GetComponentInChildren<TMP_Text>();
                
                
                buttonText.text = ability.Title;
                button.onClick.AddListener(() =>
                {
                    service.SelectAbility(ability);
                });
                
                _buttonList.Add(button);
            }
        }

        private void _toggleButtonInteractable(GameState state)
        {
            foreach (var button in _buttonList)
            {
                button.interactable = state == GameState.WaitingForInput;
            }
        }
    }
}

