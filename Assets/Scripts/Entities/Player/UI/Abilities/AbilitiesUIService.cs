using Services;
using UnityEngine;

namespace Entities.Player
{
    public class AbilitiesUIService : MonoBehaviour
    {
        [SerializeField] ExecuteAbilityButton executeButton;
        
        [SerializeField] Transform containerPrefab;
        
        [SerializeField] AbilityButton itemPrefab;
        
        AbilitiesService _abilitiesService;
        
        BaseAbility SelectedAbility => _abilitiesService.SelectedAbility;

        void Start()
        {
            _abilitiesService = ServiceLocator.Get<AbilitiesService>();
            executeButton.Initialize(_abilitiesService);
            
            CreateAbilityButtons();
        }
        
        void Update()
        {
            CheckExecuteButtonInteractable();
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

        void CheckExecuteButtonInteractable()
        {
            var interactable =
                SelectedAbility &&
                SelectedAbility.CanBeExecute &&
                GameService.GameState == GameState.Idle;

            executeButton.ToggleInteractable(interactable);
        }

        void HandleClickAbilityButton(BaseAbility ability)
        {
            // Запрет на смену абилки, пока игра не в состоянии Idle
            if (GameService.GameState != GameState.Idle) return;

            _abilitiesService.SelectAbility(ability);
        }
    }
}

